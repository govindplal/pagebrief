// pagebrief CLI.
//   pagebrief mcp                          MCP server on stdio (default)
//   pagebrief open <url> [--find <regex>]  print the page view an agent would get
//   pagebrief teach <url>                  write a page map for the URL's page type
//   pagebrief maps [list]                  list saved page maps
//   pagebrief maps export [file] [--host h]   write the maps of public sites as a shareable bundle
//   pagebrief maps import <file|url> [--verify] [--replace]   add a bundle's maps (marked imported; --verify checks each against its example page)
// Flags (or environment variables, for MCP configs):
//   --headed                 show the browser
//   --allow-private          open localhost and private-network pages (PAGEBRIEF_ALLOW_PRIVATE=1)
//   --keep-hidden            keep invisible text (PAGEBRIEF_KEEP_HIDDEN=1)
//   --allow-actions <level>  add the `do` tool: read | write | dangerous = the riskiest actions it may perform (PAGEBRIEF_ALLOW_ACTIONS)
//   --cdp-url <url>          drive a running browser (ws:// or http://host:port) instead of launching Chrome (PAGEBRIEF_CDP_URL), e.g. Lightpanda
//   --maps <dir>|off         where page maps live, default ~/.pagebrief/maps (PAGEBRIEF_MAPS_DIR, PAGEBRIEF_MAPS=off)
//   --learn <model>          write maps in the background for unmapped page types (PAGEBRIEF_LEARN)
//   --repair <model>         repair maps that fail their check (PAGEBRIEF_REPAIR), e.g. ollama:gemma3:4b
//   --teacher <model>        model for `teach`, default claude-sonnet-5-5
// Models: a Claude model id (run through the Claude Code CLI) or ollama:<model>.
import fs from "node:fs";
import { parseArgs } from "node:util";
import { Engine, type EngineOptions } from "./engine.ts";
import { llmFromSpec } from "./maps/llm.ts";
import { exportMaps, importMaps, verifyMap } from "./maps/share.ts";
import { defaultMapsDir, FileMapStore } from "./maps/store.ts";
import { LlmStudent } from "./maps/student.ts";
import { LlmTeacher } from "./maps/teacher.ts";
import { serveMcp } from "./mcp.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    find: { type: "string" },
    headed: { type: "boolean", default: false },
    "allow-private": { type: "boolean", default: false },
    "keep-hidden": { type: "boolean", default: false },
    "allow-actions": { type: "string" },
    "cdp-url": { type: "string" },
    submit: { type: "boolean", default: false },
    host: { type: "string" },
    replace: { type: "boolean", default: false },
    verify: { type: "boolean", default: false },
    maps: { type: "string" },
    learn: { type: "string" },
    repair: { type: "string" },
    teacher: { type: "string" },
  },
});
const env = process.env;
const truthy = (v: string | undefined) => /^(1|true|yes)$/i.test(v ?? "");
const [command = "mcp", url] = positionals;

const mapsSetting = values.maps ?? (/^(off|0|false|no)$/i.test(env.PAGEBRIEF_MAPS ?? "") ? "off" : (env.PAGEBRIEF_MAPS_DIR ?? defaultMapsDir()));
const learnModel = values.learn ?? env.PAGEBRIEF_LEARN;
const teacherModel = command === "teach" ? (values.teacher ?? learnModel ?? "claude-sonnet-5-5") : learnModel;
const repairModel = values.repair ?? env.PAGEBRIEF_REPAIR;

const actionsLevel = values["allow-actions"] ?? env.PAGEBRIEF_ALLOW_ACTIONS;
if (actionsLevel && !["read", "write", "dangerous"].includes(actionsLevel)) {
  console.error(`--allow-actions takes read, write or dangerous, not "${actionsLevel}"`);
  process.exit(1);
}

const engineOptions: EngineOptions = {
  cdpUrl: values["cdp-url"] ?? env.PAGEBRIEF_CDP_URL,
  actions: actionsLevel ? { allow: actionsLevel as "read" | "write" | "dangerous" } : undefined,
  headless: !values.headed,
  allowPrivate: values["allow-private"] || truthy(env.PAGEBRIEF_ALLOW_PRIVATE),
  dropHidden: !(values["keep-hidden"] || truthy(env.PAGEBRIEF_KEEP_HIDDEN)),
  maps:
    mapsSetting === "off"
      ? undefined
      : {
          store: new FileMapStore(mapsSetting),
          teacher: teacherModel ? new LlmTeacher(llmFromSpec(teacherModel)) : undefined,
          learn: !!learnModel,
          repairer: repairModel ? new LlmStudent(llmFromSpec(repairModel)) : undefined,
        },
};

async function withEngine(fn: (engine: Engine) => Promise<void>): Promise<void> {
  const engine = new Engine(engineOptions);
  try {
    await fn(engine);
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  } finally {
    await engine.close();
  }
}

if (command === "mcp") {
  await serveMcp(new Engine(engineOptions));
} else if (command === "open" && url) {
  await withEngine(async (engine) => {
    console.log(await engine.open(url));
    // Extra positionals are action ids (optionally id=value), run in order: pagebrief open <url> a3 "a5=kettle" --allow-actions read
    for (const step of positionals.slice(2)) {
      const eq = step.indexOf("=");
      console.log(`\n${await engine.act(eq < 0 ? step : step.slice(0, eq), eq < 0 ? undefined : step.slice(eq + 1), eq >= 0 && values.submit)}`);
    }
    if (values.find) console.log(`\n${engine.find(values.find)}`);
  });
} else if (command === "teach" && url) {
  if (!engineOptions.maps) {
    console.error("maps are off; pass --maps <dir>");
    process.exit(1);
  }
  await withEngine(async (engine) => {
    const { map, dropped } = await engine.learn(url);
    console.log(JSON.stringify(map, null, 2));
    if (dropped.length) console.error(`dropped: ${dropped.map((d) => `${d.name} (${d.reason})`).join("; ")}`);
    console.error(`saved to ${mapsSetting}`);
  });
} else if (command === "maps") {
  const store = new FileMapStore(mapsSetting === "off" ? defaultMapsDir() : mapsSetting);
  const [, sub = "list", arg] = positionals;
  if (sub === "list") {
    for (const m of store.list()) console.log(`${m.host}${m.pattern}  ${m.pageType}: ${m.fields.map((f) => f.name).join(", ")} (${m.source}${m.importedFrom ? ` from ${m.importedFrom}` : ""})`);
  } else if (sub === "export") {
    const { bundle, skipped } = exportMaps(store, values.host);
    const json = JSON.stringify(bundle, null, 2) + "\n";
    if (arg) fs.writeFileSync(arg, json);
    else process.stdout.write(json);
    for (const s of skipped) console.error(`not exported: ${s}`);
    console.error(`${bundle.maps.length} maps${arg ? ` written to ${arg}` : ""}`);
  } else if (sub === "import" && arg) {
    const text = /^https?:\/\//i.test(arg) ? await (await fetch(arg)).text() : fs.readFileSync(arg, "utf8");
    const verifier = values.verify
      ? async (m: import("./maps/types.ts").PageMap) => {
          const e = new Engine({ ...engineOptions, maps: undefined, actions: undefined });
          try {
            await e.open(m.exampleUrl);
            return verifyMap(m, e.page!);
          } finally {
            await e.close();
          }
        }
      : undefined;
    const report = await importMaps(JSON.parse(text), store, { from: arg, replace: values.replace, verify: verifier });
    for (const i of report.imported) console.log(`imported ${i}`);
    for (const r of report.rejected) console.error(`${r.map}: ${r.why}`);
  } else {
    console.error("usage: pagebrief maps [list | export [file] [--host h] | import <file|url> [--verify] [--replace]]");
    process.exit(1);
  }
} else {
  console.error("usage: pagebrief mcp | open <url> [--find <regex>] | teach <url> | maps   (flags: see src/cli.ts)");
  process.exit(1);
}
