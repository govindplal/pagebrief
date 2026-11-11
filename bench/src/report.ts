// Aggregates runs into a markdown report. Also a CLI that merges result dirs,
// so a baseline run and a later run of our tool can be compared:
//   npm run bench:report -- results/<baselineRun> results/<oursRun>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface RunRecord {
  runId: string;
  tool: string;
  model: string;
  taskId: string;
  site: string;
  kind: string;
  rep: number;
  status: "ok" | "error" | "timeout" | "no_browse";
  correct: boolean;
  answer: string | null;
  answerLineMissing: boolean;
  totalTokens: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  costUsd: number | null;
  wallSeconds: number;
  cliDurationMs: number | null;
  numTurns: number | null;
  toolCalls: number;
  toolCallsByName: Record<string, number>;
  toolResultChars: number;
  toolResultImages: number;
  error: string | null;
  /** Subscription 5-hour usage after this run (0-1), when the CLI reported it. */
  usageFiveHour?: number | null;
}

export interface RunMeta {
  runId: string;
  tool: string;
  toolVersion: string;
  model?: string;
  effort?: string;
  toolSearch?: boolean;
}

const median = (xs: number[]): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (n: number, d: number): string => (d ? `${Math.round((100 * n) / d)}%` : "-");
const int = (n: number): string => (Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "-");
const sec = (n: number): string => (Number.isFinite(n) ? n.toFixed(1) : "-");

interface Summary {
  tool: string;
  runs: number;
  correct: number;
  failedRuns: number;
  medTokens: number;
  meanTokens: number;
  medSeconds: number;
  meanCalls: number;
  totalCost: number;
  medCost: number;
}

function summarize(tool: string, rs: RunRecord[]): Summary {
  return {
    tool,
    runs: rs.length,
    correct: rs.filter((r) => r.correct).length,
    failedRuns: rs.filter((r) => r.status !== "ok").length,
    medTokens: median(rs.map((r) => r.totalTokens)),
    meanTokens: mean(rs.map((r) => r.totalTokens)),
    medSeconds: median(rs.map((r) => r.wallSeconds)),
    meanCalls: mean(rs.map((r) => r.toolCalls)),
    totalCost: rs.reduce((a, r) => a + (r.costUsd ?? 0), 0),
    medCost: median(rs.map((r) => r.costUsd ?? 0)),
  };
}

/** A grader label for a failed run (bench/src/grade.ts). */
export interface GradeLabel {
  tool: string;
  taskId: string;
  rep: number;
  label: string;
}

export function renderReport(records: RunRecord[], metas: RunMeta[], grades: GradeLabel[] = []): string {
  // Tools in the order the run declared them (the first is the baseline), not
  // the order concurrent runs happened to finish in.
  const tools = [...new Set([...metas.map((m) => m.tool), ...records.map((r) => r.tool)])].filter((t) =>
    records.some((r) => r.tool === t),
  );
  const byTool = new Map(tools.map((t) => [t, records.filter((r) => r.tool === t)]));
  const summaries = tools.map((t) => summarize(t, byTool.get(t)!));
  const base = summaries[0];
  const lines: string[] = [];

  lines.push("## Benchmark results", "");
  for (const m of metas)
    lines.push(`- \`${m.runId}\`: ${m.tool} ${m.toolVersion}, model ${m.model ?? "?"}, effort ${m.effort ?? "?"}${m.toolSearch ? ", tool search on" : ""}`);
  lines.push("");
  lines.push("| Tool | Runs | Success | Median tokens/task | Mean tokens/task | Median s/task | Mean tool calls | Median cost/task | Est. API cost | Tokens vs baseline | Cost vs baseline |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const s of summaries) {
    const r = base && s !== base && s.medTokens ? base.medTokens / s.medTokens : null;
    const ratio = r === null ? "baseline" : r >= 1 ? `${r.toFixed(1)}x fewer` : `${(1 / r).toFixed(1)}x more`;
    // Tokens overstate the gap: re-sent tool definitions are cache reads, billed at a fraction of the input price.
    const c = base && s !== base && s.medCost ? base.medCost / s.medCost : null;
    const costRatio = s === base ? "baseline" : c === null ? "n/a" : c >= 1 ? `${c.toFixed(1)}x cheaper` : `${(1 / c).toFixed(1)}x dearer`;
    lines.push(
      `| ${s.tool} | ${s.runs} | ${pct(s.correct, s.runs)} | ${int(s.medTokens)} | ${int(s.meanTokens)} | ${sec(s.medSeconds)} | ` +
        `${s.meanCalls.toFixed(1)} | $${s.medCost.toFixed(4)} | $${s.totalCost.toFixed(2)} | ${ratio} | ${costRatio} |`,
    );
  }
  lines.push("");
  lines.push("Tokens = input + cache reads + cache writes + output, summed over the whole task. Cost is the CLI's list-price estimate (runs used a subscription).");
  lines.push("");

  const kinds = [...new Set(records.map((r) => r.kind))].sort();
  lines.push("### By task kind", "");
  lines.push(`| Kind | ${tools.map((t) => `${t} success | ${t} median tokens`).join(" | ")} |`);
  lines.push(`|---|${tools.map(() => "---|---").join("|")}|`);
  for (const k of kinds) {
    const cells = tools.map((t) => {
      const rs = byTool.get(t)!.filter((r) => r.kind === k);
      return `${pct(rs.filter((r) => r.correct).length, rs.length)} | ${int(median(rs.map((r) => r.totalTokens)))}`;
    });
    lines.push(`| ${k} | ${cells.join(" | ")} |`);
  }
  lines.push("");

  const failures = records.filter((r) => !r.correct);
  if (failures.length) {
    lines.push("### Failed runs", "");
    lines.push(`| Tool | Task | Rep | Status | Answer / error |${grades.length ? " Grader |" : ""}`);
    lines.push(`|---|---|---|---|---|${grades.length ? "---|" : ""}`);
    for (const r of failures) {
      const detail = (r.error ?? r.answer ?? "(no ANSWER line)").replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 140);
      const g = grades.find((x) => x.tool === r.tool && x.taskId === r.taskId && x.rep === r.rep);
      lines.push(`| ${r.tool} | ${r.taskId} | ${r.rep} | ${r.status} | ${detail} |${grades.length ? ` ${g?.label ?? ""} |` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** meta.json is one tool (older runs) or several under `tools`. */
type MetaFile = RunMeta | { runId: string; model?: string; effort?: string; toolSearch?: boolean; tools: { tool: string; toolVersion: string }[] };

function readRunDir(dir: string): { records: RunRecord[]; metas: RunMeta[]; grades: GradeLabel[] } {
  const records = fs
    .readFileSync(path.join(dir, "runs.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as RunRecord);
  const m = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")) as MetaFile;
  const metas = "tools" in m ? m.tools.map((t) => ({ runId: m.runId, model: m.model, effort: m.effort, toolSearch: m.toolSearch, ...t })) : [m];
  const gradesFile = path.join(dir, "grades.jsonl");
  const grades = fs.existsSync(gradesFile)
    ? fs.readFileSync(gradesFile, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as GradeLabel)
    : [];
  return { records, metas, grades };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dirs = process.argv.slice(2);
  if (!dirs.length) {
    console.error("usage: npm run bench:report -- <resultDir> [<resultDir> ...]");
    process.exit(1);
  }
  const loaded = dirs.map(readRunDir);
  console.log(renderReport(loaded.flatMap((l) => l.records), loaded.flatMap((l) => l.metas), loaded.flatMap((l) => l.grades)));
}
