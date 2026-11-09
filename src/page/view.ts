// Turns raw page facts into what the agent reads. Pure functions, no browser.
//
// The view is compact by design: in the benchmark, tokens per task are mostly
// fixed overhead re-sent every turn, so the win comes from answering in one
// call (open) with little text, and searching (find) instead of dumping pages.

export interface FormField {
  name: string;
  type: string;
  label: string;
  options?: string[];
}

export interface Form {
  action: string;
  method: string;
  fields: FormField[];
}

/** What the in-page script returns. */
export interface RawPage {
  url: string;
  title: string;
  description: string;
  lang: string;
  text: string;
  headings: { level: number; text: string }[];
  links: { text: string; href: string }[];
  forms: Form[];
  jsonLd: string[];
}

/** A JSON response the page loaded itself (XHR/fetch, or a JSON document). */
export interface CapturedJson {
  url: string;
  status: number;
  data: unknown;
}

export interface PageData extends RawPage {
  json: CapturedJson[];
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A window of a long line around the match, so a hit deep in a minified line stays visible. */
const around = (line: string, re: RegExp, width = 120): string => {
  const m = re.exec(line);
  if (!m || line.length <= 240) return clip(line.trim(), 240);
  const start = Math.max(0, m.index - width);
  const end = Math.min(line.length, m.index + m[0].length + width);
  return `${start > 0 ? "…" : ""}${line.slice(start, end)}${end < line.length ? "…" : ""}`;
};

/**
 * The page's own JSON, when the page is a JSON document (an API response opened
 * directly). Prefers the captured response: the rendered text is cut at a size
 * limit, and a large document no longer parses from it.
 */
export function jsonDocument(p: PageData): unknown | undefined {
  const bare = p.url.split("#")[0];
  const own = p.json.find((j) => j.url === bare);
  return own ? own.data : parseJsonDocument(p.text);
}

export function parseJsonDocument(text: string): unknown | undefined {
  const t = text.trimStart();
  if (t[0] !== "{" && t[0] !== "[") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const scalar = (v: unknown): string => (typeof v === "string" ? JSON.stringify(clip(v, 200)) : String(v));

/** Flattens JSON to "path = value" lines, which are cheap to search and to read. */
/** Every value in a document is searchable; large API documents have tens of thousands of them. */
export const MAX_VALUES = 500_000;

export function flattenJson(value: unknown, prefix = "", out: string[] = [], limit = MAX_VALUES): string[] {
  if (out.length >= limit) return out;
  if (value === null || typeof value !== "object") {
    out.push(`${prefix || "."} = ${scalar(value)}`);
    return out;
  }
  const isArray = Array.isArray(value);
  const entries: [string, unknown][] = isArray ? value.map((v, i) => [String(i), v]) : Object.entries(value);
  if (!entries.length) {
    out.push(`${prefix || "."} = ${isArray ? "[]" : "{}"}`);
    return out;
  }
  for (const [k, v] of entries) {
    const key = isArray ? `${prefix}[${k}]` : prefix ? `${prefix}.${k}` : k;
    flattenJson(v, key, out, limit);
    if (out.length >= limit) break;
  }
  return out;
}

export function parseJsonLd(blocks: string[]): unknown[] {
  const out: unknown[] = [];
  for (const b of blocks) {
    try {
      out.push(JSON.parse(b));
    } catch {
      // malformed JSON-LD is common; skip it
    }
  }
  return out;
}

const shape = (data: unknown): string =>
  Array.isArray(data)
    ? `array[${data.length}]`
    : data && typeof data === "object"
      ? `{${Object.keys(data).slice(0, 10).join(", ")}${Object.keys(data).length > 10 ? ", …" : ""}}`
      : typeof data;

/** Cut text near `budget` chars, preferring a line break. */
export function cutText(text: string, budget: number): number {
  if (text.length <= budget) return text.length;
  const nl = text.lastIndexOf("\n", budget);
  return nl > budget * 0.6 ? nl : budget;
}

/** The result of open(url): everything an agent usually needs in one call. */
export function renderOpen(p: PageData, textBudget = 3000): string {
  const lines = [`# ${p.title || "(untitled)"}`, `url: ${p.url}`];
  if (p.description) lines.push(`description: ${clip(p.description, 300)}`);

  const ld = parseJsonLd(p.jsonLd)
    .flatMap((x) => flattenJson(x))
    .filter((l) => !/@context/.test(l));
  if (ld.length) {
    lines.push(`structured data (${ld.length} fields${ld.length > 25 ? ", first 25" : ""}):`);
    lines.push(...ld.slice(0, 25).map((l) => `  ${clip(l, 160)}`));
  }

  if (p.json.length) {
    lines.push(`json loaded by the page (${p.json.length}; find searches it):`);
    for (const [i, j] of p.json.slice(0, 8).entries()) lines.push(`  json#${i + 1} ${clip(j.url, 120)} ${shape(j.data)}`);
  }

  for (const f of p.forms.slice(0, 4)) {
    const fields = f.fields
      .map((x) => `${x.name}${x.label ? ` "${x.label}"` : ""}${x.options ? ` [${x.options.slice(0, 6).join("|")}]` : ""}`)
      .join(", ");
    lines.push(`form: ${f.method.toUpperCase()} ${f.action} ← ${fields}`);
  }

  const doc = jsonDocument(p);
  if (doc !== undefined) {
    const values = flattenJson(doc);
    lines.push(`json document: ${shape(doc)}, ${values.length} values${values.length > 40 ? " (first 40 shown)" : ""}:`);
    lines.push(...values.slice(0, 40).map((l) => `  ${clip(l, 160)}`));
    lines.push("[find(pattern) searches every value by path]");
    return lines.join("\n");
  }

  const cut = cutText(p.text, textBudget);
  lines.push(cut < p.text.length ? `text (first ${cut} of ${p.text.length} chars):` : "text:");
  lines.push(p.text.slice(0, cut));
  if (cut < p.text.length) lines.push(`[more: read(from=${cut}); find(pattern) searches all text, ${p.links.length} links and JSON]`);
  else if (p.links.length) lines.push(`[${p.links.length} links: find(pattern) returns their URLs]`);
  return lines.join("\n");
}

/** find(pattern): matching lines from the text, links (with URLs), loaded JSON and structured data. */
export function findIn(p: PageData, pattern: string, max = 40): string {
  let re: RegExp;
  try {
    re = new RegExp(pattern, "i");
  } catch {
    re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
  const hits: string[] = [];
  let total = 0;
  const add = (s: string) => {
    total++;
    if (hits.length < max) hits.push(s);
  };
  const doc = jsonDocument(p);
  if (doc !== undefined) {
    for (const line of flattenJson(doc)) if (re.test(line)) add(`doc ${around(line, re)}`);
  } else {
    p.text.split("\n").forEach((line, i) => {
      if (re.test(line)) add(`L${i + 1}: ${around(line, re)}`);
    });
  }
  for (const l of p.links) if (re.test(l.text) || re.test(l.href)) add(`link: ${l.text} -> ${l.href}`);
  for (const [i, j] of p.json.entries()) for (const line of flattenJson(j.data)) if (re.test(line)) add(`json#${i + 1} ${around(line, re)}`);
  for (const line of parseJsonLd(p.jsonLd).flatMap((x) => flattenJson(x))) if (re.test(line)) add(`ld ${around(line, re)}`);
  if (!total) return `no matches for /${re.source}/i`;
  return [`${total} matches for /${re.source}/i${total > max ? ` (showing ${max})` : ""}:`, ...hits].join("\n");
}

/** read(from, length): the next slice of the page text. */
export function readText(p: PageData, from: number, length = 6000): string {
  const start = Math.max(0, Math.min(from, p.text.length));
  const end = start + cutText(p.text.slice(start), length);
  const more = end < p.text.length ? `\n[more: read(from=${end})]` : "\n[end of text]";
  return `text ${start}-${end} of ${p.text.length}:\n${p.text.slice(start, end)}${more}`;
}
