// The teacher: a large model looks at everything the engine captured from one
// page and writes the map for its page type. It runs once per page type. Its
// map is then checked against the same page in code: a field whose location
// does not give back the value the teacher saw is dropped.
import { flattenJson, jsonDocument, parseJsonLd, textStart, type PageData } from "../page/view.ts";
import { applyMap, readField, sameValue, unsafeRegex } from "./apply.ts";
import { parseJsonReply, type Llm } from "./llm.ts";
import { hostKey, matchPattern, proposePattern } from "./pattern.ts";
import { MapFieldSchema, type MapField, type PageMap, type Usage } from "./types.ts";

export interface MapTeacher {
  readonly name: string;
  /** Writes a map for the page's type; throws if no usable map comes back. */
  teach(page: PageData): Promise<TeachResult>;
}

export interface TeachResult {
  map: PageMap;
  /** Fields the model proposed that failed the check on this page. */
  dropped: { name: string; reason: string }[];
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** The page as a model sees it: every source a map can point at, in the syntax a map uses. */
export function describePage(p: PageData, textChars = 9000): string {
  const out: string[] = [`URL: ${p.url}`, `TITLE: ${p.title}`];
  const meta = Object.entries(p.meta ?? {}).slice(0, 40);
  if (meta.length) out.push("", "META TAGS (from: meta, name):", ...meta.map(([k, v]) => `${k} = ${clip(v, 160)}`));
  const doc = jsonDocument(p);
  if (doc !== undefined) {
    out.push("", "THIS PAGE IS A JSON DOCUMENT (from: doc, path):", ...flattenJson(doc).slice(0, 250).map((l) => clip(l, 200)));
  } else {
    const ld = parseJsonLd(p.jsonLd).flatMap((x) => flattenJson(x));
    if (ld.length) out.push("", "JSON-LD (from: jsonld, path):", ...ld.slice(0, 150).map((l) => clip(l, 200)));
    for (const j of p.json.slice(0, 5)) {
      out.push("", `JSON RESPONSE ${j.url} (from: json, url pattern, path):`, ...flattenJson(j.data).slice(0, 100).map((l) => clip(l, 200)));
    }
    const start = textStart(p);
    out.push("", `VISIBLE TEXT (from: text, regex; chars ${start}-${Math.min(p.text.length, start + textChars)} of ${p.text.length}):`);
    out.push(p.text.slice(start, start + textChars));
  }
  return out.join("\n");
}

export const TEACHER_SYSTEM = `You write page maps for a browser engine used by AI agents. A page map says where the main facts live on one TYPE of page (every product page of a shop, every package version page of a registry), so later visits to other pages of the same type can be answered by code without reading the page.

Reply with one JSON object and nothing else:
{
  "pageType": "short label, e.g. book page",
  "pattern": "URL path pattern for this page type: replace path segments that vary between pages of this type (ids, slugs, names, versions) with *; ** matches the rest of the path. Query strings are ignored.",
  "fields": [
    {
      "name": "snake_case name, e.g. price",
      "type": "string | number | integer | date | url | boolean | list",
      "unit": "optional unit or currency, e.g. GBP",
      "optional": false,
      "example": "the value exactly as it appears on THIS page",
      "at": { "from": "doc", "path": "..." }
         or { "from": "json", "url": "path pattern of the JSON response, with * for varying segments", "path": "..." }
         or { "from": "jsonld", "path": "..." }
         or { "from": "meta", "name": "..." }
         or { "from": "text", "regex": "..." }
    }
  ]
}

Rules:
- Choose 4 to 12 fields a person would most likely ask about on this kind of page: identifiers, names, prices, dates, counts, versions, authors, ratings, status, licenses. Skip navigation, ads and site-wide boilerplate.
- Prefer structured sources: doc, then json, then jsonld, then meta, then text.
- Paths use exactly the syntax shown in the listings (a.b[0].c). Use [*] for every item of a list, with type "list".
- A text regex (JavaScript syntax, multiline mode) must anchor on the label next to the value, not on this page's values, and capture the value in group 1. It must work on other pages of the same type. No nested quantifiers like (a+)+. Escape regex characters such as ( ) . in labels.
- The example must be the value as it appears here; it is checked against the page.
- Mark a field optional only if other pages of this type plausibly lack it.`;

/** Turns a model's draft into a checked map: invalid or unverified fields are dropped. */
export function finishMap(draft: unknown, page: PageData, usage: Usage | undefined, source: PageMap["source"] = "teacher"): TeachResult {
  const d = (draft ?? {}) as { pageType?: unknown; pattern?: unknown; fields?: unknown };
  const dropped: TeachResult["dropped"] = [];
  const fields: MapField[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(d.fields) ? d.fields : []) {
    const parsed = MapFieldSchema.safeParse(raw);
    const name = (raw as { name?: string })?.name ?? "?";
    if (!parsed.success) {
      dropped.push({ name, reason: `invalid: ${parsed.error.issues[0]?.message ?? "schema"}` });
      continue;
    }
    const f = parsed.data;
    if (seen.has(f.name)) continue;
    if (f.at.from === "text" && unsafeRegex(f.at.regex)) {
      dropped.push({ name: f.name, reason: "regex has nested quantifiers" });
      continue;
    }
    const v = readField(f, page);
    if (!v.ok) {
      dropped.push({ name: f.name, reason: v.reason ?? "failed" });
      continue;
    }
    if (!sameValue(f.type, v.value!, f.example)) {
      dropped.push({ name: f.name, reason: `location gives "${clip(v.value!, 40)}", not the example "${clip(f.example, 40)}"` });
      continue;
    }
    seen.add(f.name);
    fields.push({ ...f, example: v.value! });
  }
  if (!fields.length) throw new Error(`no field in the model's map checked out on the page (${dropped.map((x) => `${x.name}: ${x.reason}`).join("; ")})`);
  let pattern = typeof d.pattern === "string" && d.pattern.startsWith("/") ? d.pattern.trim() : "";
  if (!pattern || !matchPattern(pattern, page.url) || pattern === "/**") pattern = proposePattern(page.url);
  const map: PageMap = {
    version: 1,
    host: hostKey(page.url),
    pattern,
    pageType: typeof d.pageType === "string" && d.pageType ? d.pageType.slice(0, 60) : "page",
    fields: fields.slice(0, 20),
    exampleUrl: page.url,
    createdAt: new Date().toISOString(),
    source,
    teacher: usage,
  };
  if (!applyMap(map, page).ok) throw new Error("the finished map does not check out on its own page");
  return { map, dropped };
}

export class LlmTeacher implements MapTeacher {
  readonly name: string;
  constructor(private readonly llm: Llm) {
    this.name = llm.name;
  }

  async teach(page: PageData): Promise<TeachResult> {
    const prompt = `Proposed pattern (generalize it if needed): ${proposePattern(page.url)}\n\n${describePage(page)}`;
    const reply = await this.llm.complete(TEACHER_SYSTEM, prompt);
    return finishMap(parseJsonReply(reply.text), page, reply.usage);
  }
}
