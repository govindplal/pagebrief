// Benchmark runner.
//   npm run bench -- --tool playwright-mcp --tasks bts-1,hn-1 --repeats 1
//   npm run bench -- --tool playwright-mcp,agent-browser          (all tasks, 3 repeats)
//   npm run bench -- --resume results/<runId> [--repeats 3]       (continue a stopped run)
// Writes results/<runId>/{meta.json,runs.jsonl,report.md,transcripts/}.
//
// Runs use the user's Claude subscription. Each run reports the subscription's
// 5-hour and 7-day usage; the runner stops dispatching new runs once either
// passes --stop-at / --stop-at-weekly, so a long benchmark never exhausts the
// limit. Runs that hit the limit anyway are not recorded and are retried on
// --resume.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { check, extractAnswer } from "./check.ts";
import { runClaude } from "./claude-runner.ts";
import { jobKey, planJobs, type RateLimit } from "./plan.ts";
import { renderReport, type RunMeta, type RunRecord } from "./report.ts";
import { loadTasks, type Task } from "./tasks.ts";
import { getTool, MCP_SERVER_NAME } from "./tools.ts";

const SYSTEM_PROMPT = [
  "You are a web research agent. Answer the user's question using only the browser tools provided.",
  "Start at the URL you are given. Answer only from what you read in the browser during this session, never from memory.",
  "Be efficient: use as few tool calls as you need.",
  "Finish your reply with one final line in exactly this form: ANSWER: <your answer>",
  "If you cannot find the answer, finish with: ANSWER: NOT_FOUND",
].join("\n");

const { values: opts } = parseArgs({
  options: {
    tool: { type: "string", default: "playwright-mcp" },
    tasks: { type: "string" },
    sites: { type: "string" },
    repeats: { type: "string" },
    model: { type: "string", default: "claude-sonnet-5-5" },
    effort: { type: "string", default: "medium" },
    concurrency: { type: "string", default: "1" },
    timeout: { type: "string", default: "180" },
    "max-budget": { type: "string", default: "0.5" },
    "stop-at": { type: "string", default: "0.85" },
    "stop-at-weekly": { type: "string", default: "0.9" },
    resume: { type: "string" },
    out: { type: "string", default: "results" },
    "tool-search": { type: "boolean", default: false },
    "tasks-file": { type: "string", default: "bench/tasks.json" },
  },
});

interface Meta {
  runId: string;
  tools: { tool: string; toolVersion: string; toolDescription: string }[];
  model: string;
  effort: string;
  repeats: number;
  taskIds: string[];
  claudeVersion: string;
  gitSha: string | null;
  platform: string;
  startedAt: string;
  systemPrompt: string;
  timeoutSeconds: number;
  maxBudgetUsd: number;
  /** Tool definitions loaded on demand through ToolSearch (older runs: absent, meaning off). */
  toolSearch?: boolean;
  tasksFile?: string;
}

function selectTasks(all: Task[]): Task[] {
  let tasks = all;
  if (opts.tasks) {
    const ids = new Set(opts.tasks.split(",").map((s) => s.trim()));
    const unknown = [...ids].filter((id) => !all.some((t) => t.id === id));
    if (unknown.length) throw new Error(`unknown task ids: ${unknown.join(", ")}`);
    tasks = tasks.filter((t) => ids.has(t.id));
  }
  if (opts.sites) {
    const sites = new Set(opts.sites.split(",").map((s) => s.trim()));
    tasks = tasks.filter((t) => sites.has(t.site));
  }
  if (!tasks.length) throw new Error("no tasks selected");
  return tasks;
}

function gitSha(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

const readRecords = (file: string): RunRecord[] =>
  fs.existsSync(file)
    ? fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as RunRecord)
    : [];

const reportMetas = (m: Meta): RunMeta[] =>
  m.tools.map((t) => ({ runId: m.runId, tool: t.tool, toolVersion: t.toolVersion, model: m.model, effort: m.effort, toolSearch: m.toolSearch }));

const pctOf = (x: number | null): string => (x === null ? "?" : `${Math.round(x * 100)}%`);

function newMeta(): Meta {
  const tools = opts.tool!.split(",").map((s) => getTool(s.trim()));
  const suffix = `${opts["tool-search"] ? "-toolsearch" : ""}${opts["tasks-file"] !== "bench/tasks.json" ? `-${path.basename(opts["tasks-file"]!, ".json")}` : ""}`;
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${tools.map((t) => t.id).join("+")}${suffix}`;
  return {
    runId,
    tools: tools.map((t) => ({ tool: t.id, toolVersion: t.version(), toolDescription: t.description })),
    model: opts.model!,
    effort: opts.effort!,
    repeats: Number(opts.repeats ?? 3),
    taskIds: selectTasks(loadTasks(opts["tasks-file"])).map((t) => t.id),
    claudeVersion: execFileSync("claude", ["--version"], { encoding: "utf8" }).trim(),
    gitSha: gitSha(),
    platform: `${process.platform} ${os.release()}`,
    startedAt: new Date().toISOString(),
    systemPrompt: SYSTEM_PROMPT,
    timeoutSeconds: Number(opts.timeout),
    maxBudgetUsd: Number(opts["max-budget"]),
    toolSearch: opts["tool-search"],
    tasksFile: opts["tasks-file"],
  };
}

async function main(): Promise<void> {
  let outDir: string;
  let meta: Meta;
  if (opts.resume) {
    outDir = path.resolve(opts.resume);
    meta = JSON.parse(fs.readFileSync(path.join(outDir, "meta.json"), "utf8")) as Meta;
    if (opts.repeats) meta.repeats = Number(opts.repeats);
    for (const t of meta.tools) {
      const installed = getTool(t.tool).version();
      if (installed !== t.toolVersion) throw new Error(`${t.tool} is ${installed} now, run used ${t.toolVersion}`);
    }
  } else {
    meta = newMeta();
    outDir = path.resolve(opts.out!, meta.runId);
  }
  const transcripts = path.join(outDir, "transcripts");
  fs.mkdirSync(transcripts, { recursive: true });
  fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify(meta, null, 2));

  const runsFile = path.join(outDir, "runs.jsonl");
  const records = readRecords(runsFile);
  const done = new Set(records.map((r) => jobKey(r.tool, r.taskId, r.rep)));
  const allTasks = loadTasks(meta.tasksFile);
  const tasks = meta.taskIds.map((id) => {
    const t = allTasks.find((x) => x.id === id);
    if (!t) throw new Error(`task ${id} from meta.json no longer exists`);
    return t;
  });
  const jobs = planJobs(tasks, meta.tools.map((t) => t.tool), meta.repeats, done);

  // One shared, empty working directory for every run: the CLI puts its cwd in
  // the system prompt, so a fixed cwd keeps the prompt prefix identical across
  // runs and lets the prompt cache serve it. Per-run files live in scratch dirs.
  const scratchRoot = path.join(os.tmpdir(), "pagebrief-bench", meta.runId);
  const agentCwd = path.join(scratchRoot, "agent");
  fs.mkdirSync(agentCwd, { recursive: true });

  const stopAt = Number(opts["stop-at"]);
  const stopAtWeekly = Number(opts["stop-at-weekly"]);
  let usage: RateLimit | null = null;
  let stopReason: string | null = null;
  let next = 0;
  let finished = 0;
  let launchFailuresInARow = 0;
  const concurrency = Math.max(1, Number(opts.concurrency));
  console.log(
    `${meta.runId}: ${jobs.length} runs to go (${records.length} already done), ${meta.tools.map((t) => t.tool).join(" + ")}, ` +
      `model ${meta.model}, effort ${meta.effort}${meta.toolSearch ? ", tool search on" : ""}, stop at ${pctOf(stopAt)} of the 5-hour limit`,
  );

  async function worker(): Promise<void> {
    while (next < jobs.length && !stopReason) {
      const { task, tool: toolId, rep } = jobs[next++]!;
      const tool = getTool(toolId);
      const workDir = path.join(scratchRoot, `${toolId}-${task.id}-${rep}`);
      fs.mkdirSync(workDir, { recursive: true });
      const mcpConfigPath = path.join(workDir, "mcp.json");
      fs.writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: tool.server(workDir) } }));
      const tag = `${toolId} ${task.id} #${rep}`;

      const outcome = await runClaude({
        prompt: `Start URL: ${task.url}\n\nQuestion: ${task.question}`,
        systemPrompt: SYSTEM_PROMPT,
        model: meta.model,
        effort: meta.effort,
        mcpConfigPath,
        cwd: agentCwd,
        timeoutMs: meta.timeoutSeconds * 1000,
        maxBudgetUsd: meta.maxBudgetUsd,
        transcriptPath: path.join(transcripts, `${toolId}-${task.id}-${rep}.jsonl`),
        toolSearch: meta.toolSearch,
      });
      try {
        tool.cleanup?.(workDir);
      } catch {
        // best effort
      }
      fs.rmSync(workDir, { recursive: true, force: true });

      if (outcome.rateLimit) usage = outcome.rateLimit;
      if (outcome.status === "launch_failed") {
        launchFailuresInARow++;
        console.log(`[launch failed] ${tag}: ${outcome.error} (not recorded; it reruns on --resume)`);
        if (launchFailuresInARow >= 3) {
          stopReason = "3 runs in a row failed to start (low memory?)";
          break;
        }
        continue;
      }
      launchFailuresInARow = 0;
      if (outcome.status === "quota") {
        stopReason = `usage limit hit during ${tag} (not recorded; it reruns on --resume)`;
        console.log(`[quota] ${tag}: ${outcome.error ?? outcome.resultText.slice(0, 200)}`);
        break;
      }

      const answer = extractAnswer(outcome.resultText);
      const browserCalls = Object.entries(outcome.toolCallsByName)
        .filter(([name]) => name.startsWith(`mcp__${MCP_SERVER_NAME}__`))
        .reduce((n, [, c]) => n + c, 0);
      let status: RunRecord["status"] = outcome.status;
      if (status === "ok" && browserCalls === 0) status = "no_browse";
      const correct = status === "ok" && answer !== null && check(answer, task.check);

      const record: RunRecord = {
        runId: meta.runId,
        tool: toolId,
        model: meta.model,
        taskId: task.id,
        site: task.site,
        kind: task.kind,
        rep,
        status,
        correct,
        answer,
        answerLineMissing: outcome.status === "ok" && answer === null,
        totalTokens: outcome.inputTokens + outcome.cacheReadTokens + outcome.cacheWriteTokens + outcome.outputTokens,
        inputTokens: outcome.inputTokens,
        cacheReadTokens: outcome.cacheReadTokens,
        cacheWriteTokens: outcome.cacheWriteTokens,
        outputTokens: outcome.outputTokens,
        costUsd: outcome.costUsd ?? null,
        wallSeconds: Math.round(outcome.wallSeconds * 10) / 10,
        cliDurationMs: outcome.cliDurationMs ?? null,
        numTurns: outcome.numTurns ?? null,
        toolCalls: outcome.toolCalls,
        toolCallsByName: outcome.toolCallsByName,
        toolResultChars: outcome.toolResultChars,
        toolResultImages: outcome.toolResultImages,
        error: outcome.error ?? null,
        usageFiveHour: outcome.rateLimit?.fiveHour ?? null,
      };
      records.push(record);
      fs.appendFileSync(runsFile, JSON.stringify(record) + "\n");

      finished++;
      const mark = correct ? "PASS" : status === "ok" ? "FAIL" : status.toUpperCase();
      console.log(
        `[${finished}/${jobs.length}] ${tag} ${mark} ${record.totalTokens.toLocaleString("en-US")} tok ` +
          `${record.wallSeconds}s ${record.toolCalls} calls | 5h ${pctOf(usage?.fiveHour ?? null)}` +
          (correct ? "" : ` | answer: ${answer ?? "(none)"}${record.error ? ` | ${record.error}` : ""}`),
      );

      const u = usage as RateLimit | null;
      if (u?.fiveHour != null && u.fiveHour >= stopAt)
        stopReason = `5-hour usage at ${pctOf(u.fiveHour)} (limit set to ${pctOf(stopAt)})`;
      else if (u?.sevenDay != null && u.sevenDay >= stopAtWeekly)
        stopReason = `7-day usage at ${pctOf(u.sevenDay)} (limit set to ${pctOf(stopAtWeekly)})`;
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  try {
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  } catch {
    // a browser still holding a file on Windows; the OS temp cleaner gets it later
  }

  const report = renderReport(records, reportMetas(meta));
  fs.writeFileSync(path.join(outDir, "report.md"), report);
  console.log("\n" + report);
  const remaining = planJobs(tasks, meta.tools.map((t) => t.tool), meta.repeats, new Set(records.map((r) => jobKey(r.tool, r.taskId, r.rep)))).length;
  if (remaining) {
    const u = usage as RateLimit | null;
    const resets = u?.resetsAt ? ` The 5-hour window resets at ${new Date(u.resetsAt * 1000).toLocaleString()}.` : "";
    console.log(`\nStopped with ${remaining} runs left: ${stopReason ?? "unknown"}.${resets}`);
    console.log(`Continue with: npm run bench -- --resume ${path.relative(process.cwd(), outDir)}`);
  }
  console.log(`results: ${outDir}`);
  // One line a driver script can parse (bench/scripts/campaign.ts).
  const last = usage as RateLimit | null;
  console.log(`RUN_SUMMARY ${JSON.stringify({ dir: outDir, remaining, resetsAt: last?.resetsAt ?? null, fiveHour: last?.fiveHour ?? null, sevenDay: last?.sevenDay ?? null, weekly: !!(stopReason as string | null)?.startsWith("7-day"), stopReason: stopReason as string | null })}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
