// Evaluates the page maps in bench/maps without an agent:
//  1. Load every repeat-track page with its map: hit rate (all fields checked),
//     breakage rate (a field failed its check), and field accuracy (a checked
//     field holds the task's answer, judged by the task's own answer check).
//  2. Simulated breakage: each field's location is altered the way a site
//     change would break it (a renamed JSON key or meta tag, a relabeled text
//     label). The checker must catch it (no wrong value shown), then the student
//     model repairs the map on one page, and the repaired map is checked on the
//     other nine pages against the original map's values.
//   npm run bench:maps -- [--student claude-haiku-5-5 | ollama:gemma3:4b] [--no-breakage]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { Engine } from "../../src/engine.ts";
import { applyMap, parsePath } from "../../src/maps/apply.ts";
import { llmFromSpec } from "../../src/maps/llm.ts";
import { FileMapStore } from "../../src/maps/store.ts";
import { LlmStudent } from "../../src/maps/student.ts";
import type { Location, MapResult, PageMap } from "../../src/maps/types.ts";
import type { PageData } from "../../src/page/view.ts";
import { check } from "./check.ts";
import { loadTaskFile, type Task } from "./tasks.ts";
import { BENCH_MAPS } from "./tools.ts";

const { values: opts } = parseArgs({
  options: {
    student: { type: "string", default: "claude-haiku-5-5" },
    "tasks-file": { type: "string", default: "bench/tasks-repeat.json" },
    "no-breakage": { type: "boolean", default: false },
    out: { type: "string", default: "results" },
  },
});

export interface PageResult {
  taskId: string;
  site: string;
  url: string;
  outcome: "hit" | "broken" | "none" | "blocked" | "error";
  failed: string[];
  /** The checked field whose value passes the task's answer check, if any. */
  answerField: string | null;
  error?: string;
}

export interface BreakCase {
  site: string;
  field: string;
  from: Location["from"];
  /** Pages where the altered location failed the check (the breakage was caught). */
  caught: number;
  /** Pages where the altered location still passed the check with a different value: a wrong value shown. */
  wrong: number;
  /** Pages where the altered location still gave the original value (the alteration did not break it). */
  unaffected: number;
  repair: null | {
    model: string;
    ok: boolean;
    costUsd: number | null;
    seconds: number;
    /** On the other pages of the site: repaired value equals the original map's value / differs / fails its check. */
    same: number;
    different: number;
    failed: number;
  };
}

export interface MapEvalResult {
  at: string;
  student: string | null;
  pages: PageResult[];
  breakage: BreakCase[];
}

/** Alters a location the way a site change would break it. */
export function breakLocation(at: Location): Location | null {
  switch (at.from) {
    case "doc":
    case "json":
    case "jsonld": {
      const steps = parsePath(at.path);
      let i = steps.length - 1;
      while (i >= 0 && !("key" in steps[i]!)) i--;
      if (i < 0) return null;
      const renamed = steps.map((s, j) => (j === i && "key" in s ? { key: `${s.key}_v2` } : s));
      const path = renamed.map((s, j) => ("key" in s ? `${j ? "." : ""}${/^[\w@$-]+$/.test(s.key) ? s.key : `["${s.key}"]`}` : "index" in s ? `[${s.index}]` : "[*]")).join("").replace(/\.\[/g, "[");
      return { ...at, path };
    }
    case "meta":
      return { ...at, name: `${at.name}-v2` };
    case "text": {
      const altered = at.regex.replace(/[A-Za-z]{3,}/, (w) => `Former ${w}`);
      return altered === at.regex ? null : { ...at, regex: altered };
    }
  }
}

const valueOf = (r: MapResult, name: string) => r.fields.find((f) => f.name === name);

async function main(): Promise<void> {
  const file = loadTaskFile(opts["tasks-file"]);
  const mapsCopy = fs.mkdtempSync(path.join(os.tmpdir(), "pagebrief-mapeval-"));
  fs.cpSync(BENCH_MAPS, mapsCopy, { recursive: true });
  const store = new FileMapStore(mapsCopy);
  const engine = new Engine({ maps: { store } });
  const pages: PageResult[] = [];
  const loaded = new Map<string, PageData>();

  try {
    for (const t of file.tasks) {
      const r: PageResult = { taskId: t.id, site: t.site, url: t.url, outcome: "none", failed: [], answerField: null };
      try {
        await engine.open(t.url);
        const data = engine.page!;
        loaded.set(t.id, data);
        const ev = engine.mapEvents.at(-1);
        const map = store.find(data.url);
        if (ev?.kind === "blocked") r.outcome = "blocked";
        else if (map) {
          const res = applyMap(map, data);
          r.outcome = res.ok ? "hit" : "broken";
          r.failed = res.fields.filter((f) => !f.ok && !(f.optional && f.reason === "missing")).map((f) => `${f.name}: ${f.reason}`);
          const good = res.fields.find((f) => f.ok && check(`${f.value}${f.unit ? ` ${f.unit}` : ""}`, t.check));
          r.answerField = good?.name ?? null;
        }
      } catch (err) {
        r.outcome = "error";
        r.error = err instanceof Error ? err.message : String(err);
      }
      pages.push(r);
      console.log(`${t.id} ${r.outcome}${r.answerField ? ` answer in ${r.answerField}` : ""}${r.failed.length ? ` failed: ${r.failed.join("; ")}` : ""}${r.error ? ` ${r.error}` : ""}`);
    }

    const breakage: BreakCase[] = [];
    if (!opts["no-breakage"]) {
      const student = new LlmStudent(llmFromSpec(opts.student!));
      for (const map of store.list()) {
        const sitePages = file.tasks.filter((t: Task) => loaded.has(t.id) && store.find(t.url)?.pattern === map.pattern);
        for (const field of map.fields) {
          const altered = breakLocation(field.at);
          if (!altered) continue;
          const broken: PageMap = { ...map, fields: map.fields.map((f) => (f.name === field.name ? { ...f, at: altered } : f)) };
          const bc: BreakCase = { site: map.host, field: field.name, from: field.at.from, caught: 0, wrong: 0, unaffected: 0, repair: null };
          let repairPage: Task | null = null;
          for (const t of sitePages) {
            const data = loaded.get(t.id)!;
            const orig = valueOf(applyMap(map, data), field.name)!;
            const now = valueOf(applyMap(broken, data), field.name)!;
            if (!orig.ok) continue; // the original map has no value here either
            if (!now.ok) {
              bc.caught++;
              repairPage ??= t;
            } else if (now.value === orig.value) bc.unaffected++;
            else bc.wrong++;
          }
          if (repairPage) {
            const data = loaded.get(repairPage.id)!;
            const started = performance.now();
            const repaired = await student.repair(applyMap(broken, data), data).catch(() => null);
            const rep = {
              model: student.name,
              ok: !!repaired,
              costUsd: repaired?.repairs?.at(-1)?.usage.costUsd ?? null,
              seconds: Math.round((performance.now() - started) / 100) / 10,
              same: 0,
              different: 0,
              failed: 0,
            };
            if (repaired) {
              for (const t of sitePages) {
                if (t === repairPage) continue;
                const d = loaded.get(t.id)!;
                const orig = valueOf(applyMap(map, d), field.name)!;
                const fixed = valueOf(applyMap(repaired, d), field.name)!;
                if (!orig.ok) continue;
                if (!fixed.ok) rep.failed++;
                else if (fixed.value === orig.value) rep.same++;
                else rep.different++;
              }
            }
            bc.repair = rep;
          }
          breakage.push(bc);
          console.log(
            `break ${map.host} ${field.name} (${field.at.from}): caught ${bc.caught}, wrong ${bc.wrong}, unaffected ${bc.unaffected}` +
              (bc.repair ? `; repair ${bc.repair.ok ? `ok: same ${bc.repair.same}, different ${bc.repair.different}, failed ${bc.repair.failed}` : "none"}` : ""),
          );
        }
      }
    }

    const result: MapEvalResult = { at: new Date().toISOString(), student: opts["no-breakage"] ? null : opts.student!, pages, breakage };
    const dir = path.resolve(opts.out!, `map-eval-${result.at.replace(/[:.]/g, "-").slice(0, 19)}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "map-eval.json"), JSON.stringify(result, null, 2));
    console.log(`\nresults: ${dir}`);
  } finally {
    await engine.close();
    fs.rmSync(mapsCopy, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join("bench", "src", "map-eval.ts"))) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
