// Benchmark runner.
//   npm run bench -- --tool playwright-mcp --tasks bts-1,hn-1 --repeats 1
//   npm run bench -- --tool playwright-mcp            (all tasks, 3 repeats)
// Writes results/<runId>/{meta.json,runs.jsonl,report.md,transcripts/}.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { check, extractAnswer } from "./check.ts";
import { runClaude } from "./claude-runner.ts";
import { renderReport, type RunRecord } from "./report.ts";
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
    repeats: { type: "string", default: "3" },
    model: { type: "string", default: "claude-opus-5-5" },
    effort: { type: "string", default: "medium" },
    concurrency: { type: "string", default: "1" },
    timeout: { type: "string", default: "300" },
    "max-budget": { type: "string", default: "2" },
    out: { type: "string", default: "results" },
  },
});

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

async function main(): Promise<void> {
  const tool = getTool(opts.tool!);
  const tasks = selectTasks(loadTasks());
  const repeats = Number(opts.repeats);
  const concurrency = Math.max(1, Number(opts.concurrency));
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${tool.id}`;
  const outDir = path.resolve(opts.out!, runId);
  const transcripts = path.join(outDir, "transcripts");
  fs.mkdirSync(transcripts, { recursive: true });
  const scratchRoot = path.join(os.tmpdir(), "agentic-browser-bench", runId);

  const meta = {
    runId,
    tool: tool.id,
    toolVersion: tool.version(),
    toolDescription: tool.description,
    model: opts.model,
    effort: opts.effort,
    repeats,
    taskIds: tasks.map((t) => t.id),
    claudeVersion: execFileSync("claude", ["--version"], { encoding: "utf8" }).trim(),
    gitSha: gitSha(),
    platform: `${process.platform} ${os.release()}`,
    startedAt: new Date().toISOString(),
    systemPrompt: SYSTEM_PROMPT,
  };
  fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify(meta, null, 2));

  const jobs = tasks.flatMap((task) => Array.from({ length: repeats }, (_, i) => ({ task, rep: i + 1 })));
  const runsFile = path.join(outDir, "runs.jsonl");
  const records: RunRecord[] = [];
  let next = 0;
  let done = 0;
  console.log(`${runId}: ${jobs.length} runs (${tasks.length} tasks x ${repeats}), model ${opts.model}, effort ${opts.effort}`);

  async function worker(): Promise<void> {
    while (next < jobs.length) {
      const { task, rep } = jobs[next++]!;
      const cwd = path.join(scratchRoot, `${task.id}-${rep}`);
      fs.mkdirSync(cwd, { recursive: true });
      const mcpConfigPath = path.join(cwd, "mcp.json");
      fs.writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: tool.server(cwd) } }));

      const outcome = await runClaude({
        prompt: `Start URL: ${task.url}\n\nQuestion: ${task.question}`,
        systemPrompt: SYSTEM_PROMPT,
        model: opts.model!,
        effort: opts.effort!,
        mcpConfigPath,
        cwd,
        timeoutMs: Number(opts.timeout) * 1000,
        maxBudgetUsd: Number(opts["max-budget"]),
        transcriptPath: path.join(transcripts, `${task.id}-${rep}.jsonl`),
      });

      const answer = extractAnswer(outcome.resultText);
      const browserCalls = Object.entries(outcome.toolCallsByName)
        .filter(([name]) => name.startsWith(`mcp__${MCP_SERVER_NAME}__`))
        .reduce((n, [, c]) => n + c, 0);
      let status: RunRecord["status"] = outcome.status;
      if (status === "ok" && browserCalls === 0) status = "no_browse";
      const correct = status === "ok" && answer !== null && check(answer, task.check);

      const record: RunRecord = {
        runId,
        tool: tool.id,
        model: opts.model!,
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
      };
      records.push(record);
      fs.appendFileSync(runsFile, JSON.stringify(record) + "\n");
      fs.rmSync(cwd, { recursive: true, force: true });

      done++;
      const mark = correct ? "PASS" : status === "ok" ? "FAIL" : status.toUpperCase();
      console.log(
        `[${done}/${jobs.length}] ${task.id} #${rep} ${mark} ${record.totalTokens.toLocaleString()} tok ` +
          `${record.wallSeconds}s ${record.toolCalls} calls` +
          (correct ? "" : ` | answer: ${answer ?? "(none)"}${record.error ? ` | ${record.error}` : ""}`),
      );
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  fs.rmSync(scratchRoot, { recursive: true, force: true });

  const report = renderReport(records, [meta]);
  fs.writeFileSync(path.join(outDir, "report.md"), report);
  console.log("\n" + report);
  console.log(`results: ${outDir}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
