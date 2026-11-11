// Builds a fine-tuning set for the small model from the teacher's labels.
// For each URL: load the page, ask the teacher for its map, keep it only if
// the map checks out on the page (every kept field reads back the teacher's own
// example), and write one chat example: the page description in, the map JSON
// out. Fields the check dropped are left out of the label, so the label is
// never worse than what the engine would have accepted.
//   npm run bench:sft -- --urls bench/tasks-repeat.json [--out data/sft.jsonl] [--teacher claude-sonnet-5-5] [--limit 20]
//   npm run bench:sft -- --urls urls.txt        (one URL per line)
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { Engine } from "../../src/engine.ts";
import { ClaudeCli } from "../../src/maps/llm.ts";
import { describePage, finishMap, TEACHER_SYSTEM } from "../../src/maps/teacher.ts";
import { hostKey, proposePattern } from "../../src/maps/pattern.ts";
import { parseJsonReply } from "../../src/maps/llm.ts";
import { loadTaskFile } from "./tasks.ts";

export interface SftExample {
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  meta: { url: string; host: string; teacher: string; fields: number; dropped: number };
}

function urlsFrom(file: string): string[] {
  if (file.endsWith(".json")) {
    const f = loadTaskFile(file);
    return [...new Set([...(f.teach ?? []).map((t) => t.url), ...f.tasks.map((t) => t.url)])];
  }
  return fs.readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter((l) => /^https?:/.test(l));
}

async function main(): Promise<void> {
  const { values: opts } = parseArgs({
    options: {
      urls: { type: "string", default: "bench/tasks-repeat.json" },
      out: { type: "string", default: "data/sft.jsonl" },
      teacher: { type: "string", default: "claude-sonnet-5-5" },
      limit: { type: "string" },
    },
  });
  const urls = urlsFrom(opts.urls!).slice(0, opts.limit ? Number(opts.limit) : undefined);
  const llm = new ClaudeCli(opts.teacher!);
  const engine = new Engine({});
  fs.mkdirSync(path.dirname(opts.out!), { recursive: true });
  let kept = 0;
  try {
    for (const url of urls) {
      try {
        await engine.open(url);
        const page = engine.page!;
        const prompt = `Proposed pattern (generalize it if needed): ${proposePattern(page.url)}\n\n${describePage(page)}`;
        const reply = await llm.complete(TEACHER_SYSTEM, prompt);
        const draft = parseJsonReply(reply.text) as { pageType?: unknown; pattern?: unknown; fields?: unknown[] };
        const { map, dropped } = finishMap(draft, page, reply.usage);
        const label = { pageType: map.pageType, pattern: map.pattern, fields: map.fields };
        const ex: SftExample = {
          messages: [
            { role: "system", content: TEACHER_SYSTEM },
            { role: "user", content: prompt },
            { role: "assistant", content: JSON.stringify(label) },
          ],
          meta: { url, host: hostKey(url), teacher: opts.teacher!, fields: map.fields.length, dropped: dropped.length },
        };
        fs.appendFileSync(opts.out!, JSON.stringify(ex) + "\n");
        kept++;
        console.log(`${url}: ${map.fields.length} fields${dropped.length ? `, ${dropped.length} dropped` : ""}`);
      } catch (err) {
        console.log(`${url}: skipped (${err instanceof Error ? err.message.slice(0, 120) : err})`);
      }
    }
  } finally {
    await engine.close();
  }
  console.log(`${kept} of ${urls.length} examples written to ${opts.out}`);
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join("bench", "src", "export-sft.ts"))) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
