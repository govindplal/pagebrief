import assert from "node:assert/strict";
import { test } from "node:test";
import { jobKey, parseRateLimit, planJobs, QUOTA_ERROR } from "./plan.ts";

const tasks = [{ id: "a" }, { id: "b" }];

test("planJobs is repeat-major and interleaves tools", () => {
  const jobs = planJobs(tasks, ["x", "y"], 2).map((j) => jobKey(j.tool, j.task.id, j.rep));
  assert.deepEqual(jobs, ["x|a|1", "y|a|1", "x|b|1", "y|b|1", "x|a|2", "y|a|2", "x|b|2", "y|b|2"]);
});

test("planJobs skips finished jobs when resuming", () => {
  const done = new Set(["x|a|1", "y|a|1", "x|b|1"]);
  const jobs = planJobs(tasks, ["x", "y"], 1, done).map((j) => jobKey(j.tool, j.task.id, j.rep));
  assert.deepEqual(jobs, ["y|b|1"]);
});

test("parseRateLimit reads Claude Code's rate_limit_event", () => {
  const r = parseRateLimit({
    status: "allowed",
    resetsAt: 1794224400,
    rateLimitType: "five_hour",
    unifiedWindows: {
      five_hour: { utilization: 0.18, resetsAt: 1794224400, status: "allowed" },
      seven_day: { utilization: 0.07, resetsAt: 1794697200, status: "allowed" },
    },
  });
  assert.deepEqual(r, { status: "allowed", fiveHour: 0.18, sevenDay: 0.07, resetsAt: 1794224400 });
  assert.equal(parseRateLimit({}).fiveHour, null);
});

test("QUOTA_ERROR matches limit messages, not ordinary failures", () => {
  assert.ok(QUOTA_ERROR.test("Claude AI usage limit reached|1794224400"));
  assert.ok(QUOTA_ERROR.test("You've hit your limit · resets 3pm. Your limit will reset at 3pm"));
  assert.ok(!QUOTA_ERROR.test("error_max_budget_usd: spent $0.51"));
});
