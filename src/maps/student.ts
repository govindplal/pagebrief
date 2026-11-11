// The student: a small model that runs only when a map fails its check on a
// page. It proposes new locations for the failed fields; each one must pass the
// same code check before it is used. When it is unsure, or its answer fails the
// check, the engine shows the text view as before.
import type { PageData } from "../page/view.ts";
import { applyMap, readField, unsafeRegex } from "./apply.ts";
import { parseJsonReply, type Llm } from "./llm.ts";
import { describePage } from "./teacher.ts";
import { LocationSchema, type MapResult, type PageMap } from "./types.ts";

export interface MapRepairer {
  readonly name: string;
  /** A repaired map for this page, or null when the repair is unsure or does not check out. */
  repair(result: MapResult, page: PageData): Promise<PageMap | null>;
}

export const STUDENT_SYSTEM = `You repair page maps for a browser engine. A page map says where facts live on one type of page. Some fields of the map no longer work on the page below (the site changed). For each broken field, find where its value lives on this page now.

Reply with one JSON object and nothing else:
{ "fields": [ { "name": "the field's name", "confident": true, "at": <location> } ] }

A location is one of:
{ "from": "doc", "path": "..." } | { "from": "json", "url": "path pattern of the JSON response", "path": "..." } | { "from": "jsonld", "path": "..." } | { "from": "meta", "name": "..." } | { "from": "text", "regex": "..." }

Paths use the syntax shown in the listings (a.b[0].c). A text regex (JavaScript, multiline mode) anchors on the label next to the value and captures the value in group 1. Set "confident": false, or leave the field out, if the page does not clearly show it.`;

export class LlmStudent implements MapRepairer {
  readonly name: string;
  constructor(private readonly llm: Llm) {
    this.name = llm.name;
  }

  async repair(result: MapResult, page: PageData): Promise<PageMap | null> {
    const broken = result.fields.filter((f) => f.fatal);
    if (!broken.length) return null;
    const lines = broken.map((b) => {
      const f = result.map.fields.find((x) => x.name === b.name)!;
      return `- ${f.name} (${f.type}${f.unit ? `, ${f.unit}` : ""}): was at ${JSON.stringify(f.at)}, example value on another page "${f.example}"; now ${b.reason}`;
    });
    const prompt = `Page type: ${result.map.pageType}\nBroken fields:\n${lines.join("\n")}\n\n${describePage(page, 6000)}`;
    const reply = await this.llm.complete(STUDENT_SYSTEM, prompt);
    let draft: { fields?: { name?: string; confident?: boolean; at?: unknown }[] };
    try {
      draft = parseJsonReply(reply.text) as typeof draft;
    } catch {
      return null;
    }
    const fixed = new Map<string, PageMap["fields"][number]>();
    for (const d of draft.fields ?? []) {
      const old = result.map.fields.find((x) => x.name === d.name);
      const at = LocationSchema.safeParse(d.at);
      if (!old || !d.confident || !at.success || !broken.some((b) => b.name === d.name)) continue;
      if (at.data.from === "text" && unsafeRegex(at.data.regex)) continue;
      const candidate = { ...old, at: at.data };
      const v = readField(candidate, page);
      if (v.ok) fixed.set(old.name, { ...candidate, example: v.value! });
    }
    if (!fixed.size) return null;
    const map: PageMap = {
      ...result.map,
      fields: result.map.fields.map((f) => fixed.get(f.name) ?? f),
      source: "student",
      repairs: [...(result.map.repairs ?? []), { at: new Date().toISOString(), url: page.url, fields: [...fixed.keys()], usage: reply.usage }].slice(-20),
    };
    return applyMap(map, page).ok ? map : null;
  }
}
