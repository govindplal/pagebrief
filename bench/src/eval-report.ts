// The page-map evaluation report: first visit against repeat visit (from a
// benchmark run on the repeat-visit track), the teacher's cost, map quality and
// simulated breakage (from map-eval.json), and failure labels from the grader.
//   npm run bench:eval -- --run results/<runId> --map-eval results/map-eval-<ts>/map-eval.json [--out docs/results/x.md]
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { Grade } from "./grade.ts";
import type { MapEvalResult } from "./map-eval.ts";
import type { RunRecord } from "./report.ts";
import type { TeachLogEntry } from "./teach.ts";
import { TEACH_LOG } from "./teach.ts";

const median = (xs: number[]): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "-");
const int = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "-");
const ratio = (a: number, b: number, more: string, less: string) => (!a || !b ? "-" : a >= b ? `${(a / b).toFixed(1)}x ${more}` : `${(b / a).toFixed(1)}x ${less}`);

const readJsonl = <T>(file: string): T[] =>
  fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T) : [];

export function renderEval(runDir: string | null, mapEval: MapEvalResult | null, teachLog: TeachLogEntry[]): string {
  const out: string[] = ["## Page maps: first visit against repeat visit", ""];

  // Latest successful teaching per site.
  const taught = new Map<string, TeachLogEntry>();
  for (const t of teachLog) if (t.ok) taught.set(t.site, t);
  const teachCost = [...taught.values()].reduce((a, t) => a + (t.costUsd ?? 0), 0);

  if (runDir) {
    const records = readJsonl<RunRecord>(path.join(runDir, "runs.jsonl"));
    const meta = JSON.parse(fs.readFileSync(path.join(runDir, "meta.json"), "utf8")) as { runId: string; model: string; effort: string; repeats: number; tools: { tool: string; toolVersion: string }[] };
    out.push(`Run \`${meta.runId}\`: ${meta.tools.map((t) => `${t.tool} ${t.toolVersion}`).join(", ")}; model ${meta.model}, effort ${meta.effort}.`, "");
    out.push("| Tool | Visit | Runs | Success | Median tokens/task | Median cost/task | Median s/task | Mean tool calls |", "|---|---|---|---|---|---|---|---|");
    const sum = new Map<string, { med: number; cost: number; sec: number; ok: number; n: number }>();
    for (const t of meta.tools) {
      const rs = records.filter((r) => r.tool === t.tool);
      if (!rs.length) continue;
      const s = { med: median(rs.map((r) => r.totalTokens)), cost: median(rs.map((r) => r.costUsd ?? 0)), sec: median(rs.map((r) => r.wallSeconds)), ok: rs.filter((r) => r.correct).length, n: rs.length };
      sum.set(t.tool, s);
      const visit = t.tool === "pagebrief-mapped" ? "repeat (page map)" : t.tool === "pagebrief" ? "first (no map)" : "baseline";
      out.push(`| ${t.tool} | ${visit} | ${s.n} | ${pct(s.ok, s.n)} | ${int(s.med)} | $${s.cost.toFixed(4)} | ${s.sec.toFixed(1)} | ${mean(rs.map((r) => r.toolCalls)).toFixed(1)} |`);
    }
    out.push("");
    const first = sum.get("pagebrief");
    const repeat = sum.get("pagebrief-mapped");
    if (first && repeat) {
      out.push(
        `Repeat visit against first visit: ${ratio(first.med, repeat.med, "fewer", "more")} tokens, ${ratio(first.cost, repeat.cost, "cheaper", "dearer")}, ` +
          `${ratio(first.sec, repeat.sec, "faster", "slower")} (medians), success ${pct(repeat.ok, repeat.n)} against ${pct(first.ok, first.n)}.`,
      );
      for (const [tool, s] of sum) {
        if (tool.startsWith("pagebrief")) continue;
        out.push(`Repeat visit against ${tool}: ${ratio(s.med, repeat.med, "fewer", "more")} tokens, ${ratio(s.cost, repeat.cost, "cheaper", "dearer")}, ${ratio(s.sec, repeat.sec, "faster", "slower")}.`);
      }
      if (taught.size) {
        const perSite = teachCost / taught.size;
        const visits = 10;
        out.push(
          "",
          `Teaching cost: ${taught.size} maps for $${teachCost.toFixed(2)} in total ($${perSite.toFixed(3)} per page type, ${[...taught.values()][0]!.teacher}). ` +
            `Charged to ${visits} visits of a page type, a repeat visit costs $${(repeat.cost + perSite / visits).toFixed(4)} against $${first.cost.toFixed(4)} for a first visit ` +
            `(${ratio(first.cost, repeat.cost + perSite / visits, "cheaper", "dearer")}); the teaching pays for itself after ${Math.max(1, Math.ceil(perSite / Math.max(1e-9, first.cost - repeat.cost)))} visits.`,
        );
      }
    }
    out.push("");

    const grades = readJsonl<Grade>(path.join(runDir, "grades.jsonl"));
    if (grades.length) {
      out.push("### Why runs failed (grader labels)", "");
      const labels = [...new Set(grades.map((g) => g.label))].sort();
      out.push(`| Tool | ${labels.join(" | ")} |`, `|---|${labels.map(() => "---").join("|")}|`);
      for (const t of meta.tools) {
        const gs = grades.filter((g) => g.tool === t.tool);
        if (gs.length) out.push(`| ${t.tool} | ${labels.map((l) => gs.filter((g) => g.label === l).length).join(" | ")} |`);
      }
      out.push("", ...grades.map((g) => `- ${g.tool} ${g.taskId} #${g.rep}: **${g.label}**: ${g.reason}`), "");
    }
  }

  if (taught.size) {
    out.push("### The maps", "", "| Site | Pattern | Fields | Teacher cost | Seconds |", "|---|---|---|---|---|");
    for (const t of taught.values()) out.push(`| ${t.site} | \`${t.pattern}\` | ${t.fields?.length ?? 0}: ${t.fields?.join(", ")} | $${(t.costUsd ?? 0).toFixed(4)} | ${t.seconds ?? "-"} |`);
    out.push("");
  }

  if (mapEval) {
    const ps = mapEval.pages;
    const hits = ps.filter((p) => p.outcome === "hit").length;
    const broken = ps.filter((p) => p.outcome === "broken").length;
    const mapped = hits + broken;
    out.push("### Map quality (code only, no agent)", "");
    out.push(
      `${ps.length} pages: map hit (every field checked) ${pct(hits, ps.length)}, breakage (a field failed its check) ${pct(broken, mapped)} of mapped loads, ` +
        `no map ${ps.filter((p) => p.outcome === "none").length}, blocked ${ps.filter((p) => p.outcome === "blocked").length}, errors ${ps.filter((p) => p.outcome === "error").length}. ` +
        `Field accuracy (a checked field passes the task's answer check): ${pct(ps.filter((p) => p.answerField).length, ps.length)}.`,
      "",
    );
    out.push("| Site | Pages | Hit | Broken | Answer in a field |", "|---|---|---|---|---|");
    for (const site of [...new Set(ps.map((p) => p.site))]) {
      const s = ps.filter((p) => p.site === site);
      out.push(`| ${site} | ${s.length} | ${s.filter((p) => p.outcome === "hit").length} | ${s.filter((p) => p.outcome === "broken").length} | ${s.filter((p) => p.answerField).length} |`);
    }
    out.push("");
    const bs = mapEval.breakage;
    if (bs.length) {
      const caught = bs.reduce((a, b) => a + b.caught, 0);
      const wrong = bs.reduce((a, b) => a + b.wrong, 0);
      const unaffected = bs.reduce((a, b) => a + b.unaffected, 0);
      const tried = bs.filter((b) => b.repair);
      const repaired = tried.filter((b) => b.repair!.ok);
      const same = repaired.reduce((a, b) => a + b.repair!.same, 0);
      const diff = repaired.reduce((a, b) => a + b.repair!.different, 0);
      const fail = repaired.reduce((a, b) => a + b.repair!.failed, 0);
      const cost = tried.reduce((a, b) => a + (b.repair!.costUsd ?? 0), 0);
      out.push("### Simulated breakage and student repairs", "");
      out.push(
        `Each mapped field's location was altered the way a site change breaks it (a renamed JSON key or meta tag, a relabeled text label), on every page of its site. ` +
          `${bs.length} altered fields over ${caught + wrong + unaffected} page loads: the checker caught ${caught}, **${wrong} wrong values were shown**, ${unaffected} loads were unaffected by the alteration.`,
        "",
        `Student (${mapEval.student}) repaired ${repaired.length} of ${tried.length} broken fields from one page each ($${cost.toFixed(3)} in total). ` +
          `On the other pages of the site, repaired locations gave the original map's value ${same} times, a different value ${diff} times, and failed their check ${fail} times (the text view is shown instead).`,
        "",
      );
      out.push("| Location kind | Altered fields | Caught loads | Wrong values shown | Repaired | Same value elsewhere | Different elsewhere |", "|---|---|---|---|---|---|---|");
      for (const kind of [...new Set(bs.map((b) => b.from))]) {
        const k = bs.filter((b) => b.from === kind);
        const kr = k.filter((b) => b.repair?.ok);
        out.push(
          `| ${kind} | ${k.length} | ${k.reduce((a, b) => a + b.caught, 0)} | ${k.reduce((a, b) => a + b.wrong, 0)} | ${kr.length} of ${k.filter((b) => b.repair).length} | ` +
            `${kr.reduce((a, b) => a + b.repair!.same, 0)} | ${kr.reduce((a, b) => a + b.repair!.different, 0)} |`,
        );
      }
      out.push("", "The breakage is simulated: real site changes can also move a value without breaking its old location, which this test does not cover.", "");
    }
  }
  return out.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join("bench", "src", "eval-report.ts"))) {
  const { values: opts } = parseArgs({ options: { run: { type: "string" }, "map-eval": { type: "string" }, out: { type: "string" } } });
  const mapEval = opts["map-eval"] ? (JSON.parse(fs.readFileSync(opts["map-eval"], "utf8")) as MapEvalResult) : null;
  const md = renderEval(opts.run ?? null, mapEval, readJsonl<TeachLogEntry>(TEACH_LOG));
  if (opts.out) fs.writeFileSync(opts.out, md + "\n");
  console.log(md);
}
