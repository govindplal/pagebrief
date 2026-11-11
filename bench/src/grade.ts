// The grader: a large model reads each failed run (question, answer key, the
// agent's answer, and what the browser tool returned) and labels why it failed.
// Runs offline, after a benchmark run; labels go to <runDir>/grades.jsonl.
//   npm run bench:grade -- results/<runId> [--model claude-opus-5-5]
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { ClaudeCli, parseJsonReply } from "../../src/maps/llm.ts";
import type { RunRecord } from "./report.ts";
import { loadTasks } from "./tasks.ts";

export const LABELS = ["wrong_field", "stale_map", "missing_data", "blocked", "agent_error", "answer_key", "out_of_time"] as const;
export type Label = (typeof LABELS)[number];

export interface Grade {
  tool: string;
  taskId: string;
  rep: number;
  label: Label;
  reason: string;
  model: string;
  costUsd: number | null;
}

const GRADER_SYSTEM = `You grade failed runs of a web-browsing benchmark. An agent answered a question about a web page using browser tools, and its answer failed the answer key. Read the evidence and decide the single main reason it failed.

Labels:
- wrong_field: the tool output showed a labeled field or value, but for a different fact than the question asked (e.g. a page map field pointing at the wrong thing).
- stale_map: the tool output said a page map failed its check, or showed a mapped value that no longer matches the page.
- missing_data: the tool output never contained the answer (the page lacked it, or the tool did not surface it).
- blocked: the page was a bot check, a login wall, or failed to load.
- agent_error: the answer was in the tool output, but the agent misread it, picked the wrong item, or reported it wrongly.
- answer_key: the agent's answer looks correct and the answer key or its check is wrong or too strict.
- out_of_time: the run hit its time or budget limit before answering.

Reply with one JSON object and nothing else: {"label": "<one label>", "reason": "<one sentence, under 30 words>"}`;

interface StreamLine {
  type: string;
  message?: { content?: unknown };
  result?: string;
}

/** The tool calls and their outputs from a run transcript, clipped to fit a prompt. */
export function evidence(transcriptFile: string, maxChars = 12_000): string {
  if (!fs.existsSync(transcriptFile)) return "(no transcript)";
  const parts: string[] = [];
  for (const line of fs.readFileSync(transcriptFile, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let m: StreamLine;
    try {
      m = JSON.parse(line) as StreamLine;
    } catch {
      continue;
    }
    const content = Array.isArray(m.message?.content) ? (m.message!.content as Record<string, unknown>[]) : [];
    for (const b of content) {
      if (b.type === "tool_use") parts.push(`CALL ${String(b.name)} ${JSON.stringify(b.input).slice(0, 300)}`);
      if (b.type === "tool_result") {
        const c = b.content;
        const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((x: { text?: string }) => x.text ?? "").join("\n") : "";
        parts.push(`RESULT ${text.slice(0, 2500)}${text.length > 2500 ? " …(clipped)" : ""}`);
      }
    }
    if (m.type === "result" && m.result) parts.push(`FINAL ${m.result.slice(-800)}`);
  }
  const all = parts.join("\n\n");
  return all.length > maxChars ? `${all.slice(0, maxChars / 2)}\n…\n${all.slice(-maxChars / 2)}` : all;
}

async function main(): Promise<void> {
  const { values: opts, positionals } = parseArgs({
    allowPositionals: true,
    options: { model: { type: "string", default: "claude-sonnet-5-5" }, "tasks-file": { type: "string" } },
  });
  const dir = positionals[0];
  if (!dir) throw new Error("usage: npm run bench:grade -- results/<runId> [--model <id>]");
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")) as { tasksFile?: string };
  const tasks = loadTasks(opts["tasks-file"] ?? meta.tasksFile ?? "bench/tasks.json");
  const records = fs.readFileSync(path.join(dir, "runs.jsonl"), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as RunRecord);
  const gradesFile = path.join(dir, "grades.jsonl");
  const done = new Set(
    (fs.existsSync(gradesFile) ? fs.readFileSync(gradesFile, "utf8").split("\n").filter((l) => l.trim()) : []).map((l) => {
      const g = JSON.parse(l) as Grade;
      return `${g.tool}|${g.taskId}|${g.rep}`;
    }),
  );
  const llm = new ClaudeCli(opts.model!, { maxBudgetUsd: 0.5 });
  const failed = records.filter((r) => !r.correct && !done.has(`${r.tool}|${r.taskId}|${r.rep}`));
  console.log(`${failed.length} failed runs to grade with ${opts.model}`);
  for (const r of failed) {
    const task = tasks.find((t) => t.id === r.taskId);
    const prompt = [
      `QUESTION: ${task?.question ?? "?"}`,
      `START URL: ${task?.url ?? "?"}`,
      `ANSWER KEY (machine check): ${JSON.stringify(task?.check)}`,
      `AGENT'S ANSWER: ${r.answer ?? "(none)"}`,
      `RUN STATUS: ${r.status}${r.error ? ` (${r.error})` : ""}`,
      "",
      "WHAT THE BROWSER TOOL RETURNED:",
      evidence(path.join(dir, "transcripts", `${r.tool}-${r.taskId}-${r.rep}.jsonl`)),
    ].join("\n");
    let grade: Grade;
    try {
      const reply = await llm.complete(GRADER_SYSTEM, prompt);
      const g = parseJsonReply(reply.text) as { label?: string; reason?: string };
      const label = (LABELS as readonly string[]).includes(g.label ?? "") ? (g.label as Label) : "agent_error";
      grade = { tool: r.tool, taskId: r.taskId, rep: r.rep, label, reason: String(g.reason ?? "").slice(0, 300), model: opts.model!, costUsd: reply.usage.costUsd };
    } catch (err) {
      console.log(`${r.tool} ${r.taskId} #${r.rep}: grading failed: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    fs.appendFileSync(gradesFile, JSON.stringify(grade) + "\n");
    console.log(`${r.tool} ${r.taskId} #${r.rep}: ${grade.label} - ${grade.reason}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join("bench", "src", "grade.ts"))) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
