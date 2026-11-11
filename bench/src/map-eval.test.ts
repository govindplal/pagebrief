import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { claudeArgs, type RunSpec } from "./claude-runner.ts";
import { evidence } from "./grade.ts";
import { breakLocation } from "./map-eval.ts";

test("breakLocation alters a location the way a site change would", () => {
  assert.deepEqual(breakLocation({ from: "json", url: "/api/*", path: "version.license" }), { from: "json", url: "/api/*", path: "version.license_v2" });
  assert.deepEqual(breakLocation({ from: "jsonld", path: "offers[0].price" }), { from: "jsonld", path: "offers[0].price_v2" });
  assert.deepEqual(breakLocation({ from: "doc", path: "items[*].name" }), { from: "doc", path: "items[*].name_v2" });
  assert.deepEqual(breakLocation({ from: "meta", name: "citation_title" }), { from: "meta", name: "citation_title-v2" });
  assert.deepEqual(breakLocation({ from: "text", regex: "^UPC\\t(\\w+)" }), { from: "text", regex: "^Former UPC\\t(\\w+)" });
  assert.equal(breakLocation({ from: "text", regex: "^(\\d+)$" }), null);
});

test("the grader's evidence lists tool calls, their results and the final reply", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pagebrief-grade-"));
  const file = path.join(dir, "t.jsonl");
  fs.writeFileSync(
    file,
    [
      { type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__browser__open", input: { url: "https://x.example" } }] } },
      { type: "user", message: { content: [{ type: "tool_result", content: [{ type: "text", text: "# X\nprice = 5" }] }] } },
      { type: "result", result: "ANSWER: 5" },
    ]
      .map((l) => JSON.stringify(l))
      .join("\n"),
  );
  try {
    assert.equal(evidence(file), 'CALL mcp__browser__open {"url":"https://x.example"}\n\nRESULT # X\nprice = 5\n\nFINAL ANSWER: 5');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("tool search mode gives the agent only ToolSearch and turns deferred loading on", () => {
  const spec: RunSpec = {
    prompt: "q",
    systemPrompt: "s",
    model: "m",
    effort: "medium",
    mcpConfigPath: "mcp.json",
    cwd: ".",
    timeoutMs: 1,
    maxBudgetUsd: 1,
    transcriptPath: "t",
  };
  const off = claudeArgs(spec);
  assert.equal(off[off.indexOf("--tools") + 1], "");
  assert.equal(off[off.indexOf("--allowedTools") + 1], "mcp__browser");
  const on = claudeArgs({ ...spec, toolSearch: true });
  assert.equal(on[on.indexOf("--tools") + 1], "ToolSearch");
  assert.equal(on[on.indexOf("--allowedTools") + 1], "mcp__browser ToolSearch");
});
