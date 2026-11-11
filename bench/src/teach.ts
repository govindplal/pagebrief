// Writes the page maps for the repeat-visit track: the teacher model maps each
// site's teach page once, and the maps are saved to bench/maps (committed, so
// every mapped run uses the same maps). Each teaching's cost is logged so the
// evaluation can charge it to the repeat visits.
//   npm run bench:teach -- [--teacher claude-opus-5-5] [--sites a.com,b.com]
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { Engine } from "../../src/engine.ts";
import { ClaudeCli } from "../../src/maps/llm.ts";
import { FileMapStore } from "../../src/maps/store.ts";
import { LlmTeacher } from "../../src/maps/teacher.ts";
import { loadTaskFile } from "./tasks.ts";
import { BENCH_MAPS } from "./tools.ts";

export interface TeachLogEntry {
  at: string;
  site: string;
  url: string;
  teacher: string;
  ok: boolean;
  pattern?: string;
  fields?: string[];
  dropped?: { name: string; reason: string }[];
  costUsd?: number | null;
  tokens?: number;
  seconds?: number;
  error?: string;
}

export const TEACH_LOG = path.join(BENCH_MAPS, "teach-log.jsonl");

async function main(): Promise<void> {
  const { values: opts } = parseArgs({
    options: {
      teacher: { type: "string", default: "claude-opus-5-5" },
      "tasks-file": { type: "string", default: "bench/tasks-repeat.json" },
      sites: { type: "string" },
    },
  });
  const file = loadTaskFile(opts["tasks-file"]);
  const only = opts.sites ? new Set(opts.sites.split(",")) : null;
  const entries = (file.teach ?? []).filter((t) => !only || only.has(t.site));
  if (!entries.length) throw new Error("nothing to teach");
  fs.mkdirSync(BENCH_MAPS, { recursive: true });
  const engine = new Engine({ maps: { store: new FileMapStore(BENCH_MAPS), teacher: new LlmTeacher(new ClaudeCli(opts.teacher!)) } });
  try {
    for (const t of entries) {
      const log: TeachLogEntry = { at: new Date().toISOString(), site: t.site, url: t.url, teacher: opts.teacher!, ok: false };
      try {
        const { map, dropped } = await engine.learn(t.url);
        Object.assign(log, {
          ok: true,
          pattern: map.pattern,
          fields: map.fields.map((f) => f.name),
          dropped,
          costUsd: map.teacher?.costUsd ?? null,
          tokens: map.teacher?.tokens,
          seconds: map.teacher?.seconds,
        });
        console.log(`${t.site}${map.pattern}: ${map.pageType}, ${map.fields.length} fields (${log.fields!.join(", ")})` +
          `${dropped.length ? `; dropped ${dropped.map((d) => d.name).join(", ")}` : ""}; $${map.teacher?.costUsd?.toFixed(4)}, ${map.teacher?.seconds}s`);
      } catch (err) {
        log.error = err instanceof Error ? err.message : String(err);
        console.log(`${t.site}: FAILED ${log.error}`);
      }
      fs.appendFileSync(TEACH_LOG, JSON.stringify(log) + "\n");
    }
  } finally {
    await engine.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join("bench", "src", "teach.ts"))) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
