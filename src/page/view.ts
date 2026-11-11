// Turns raw page facts into what the agent reads. Pure functions, no browser.
//
// The view is compact by design: in the benchmark, tokens per task are mostly
// fixed overhead re-sent every turn, so the win comes from answering in one
// call (open) with little text, and searching (find) instead of dumping pages.
import type { MapResult } from "../maps/types.ts";

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
  /** Offset in `text` where the main content (<main>, role=main or <article>) starts; 0 if unknown. */
  mainStart?: number;
  headings: { level: number; text: string }[];
  links: { text: string; href: string }[];
  forms: Form[];
  jsonLd: string[];
  /** <meta name|property> tags, first 60. */
  meta?: Record<string, string>;
  signals?: PageSignals;
}

export interface PageSignals {
  /** A bot-check widget (Cloudflare, hCaptcha, reCAPTCHA, DataDome, PerimeterX) is on the page. */
  challenge: boolean;
  hasPassword: boolean;
  /** Rendered but invisible text that was dropped (zero opacity, zero font size, off screen). */
  hiddenChars: number;
  hiddenElements: number;
  /** The start of the first few dropped elements' text, for measuring what the drop removes. */
  hiddenSamples?: string[];
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

/** Skip the header only when it is long enough to matter and real content follows it. */
const MIN_HEADER_SKIP = 300;
const MIN_MAIN_TEXT = 200;

/** Where open() starts the text: at the main content when the page marks one, else at the top. */
export function textStart(p: Pick<RawPage, "text" | "mainStart">): number {
  const m = p.mainStart ?? 0;
  return m >= MIN_HEADER_SKIP && p.text.length - m >= MIN_MAIN_TEXT ? m : 0;
}

/** Flattened lines per page, computed once: find() runs many times on one page. */
interface PageLines {
  doc: string[] | undefined;
  json: string[][];
  ld: string[];
}
const lineCache = new WeakMap<PageData, PageLines>();

function linesOf(p: PageData): PageLines {
  let lines = lineCache.get(p);
  if (!lines) {
    const doc = jsonDocument(p);
    lines = {
      doc: doc === undefined ? undefined : flattenJson(doc),
      json: p.json.map((j) => flattenJson(j.data)),
      ld: parseJsonLd(p.jsonLd).flatMap((x) => flattenJson(x)),
    };
    lineCache.set(p, lines);
  }
  return lines;
}

const BOT_TITLE =
  /just a moment|attention required|access denied|are you a (robot|human)|verify(ing)? (that )?you are (a )?human|security check|human verification|pardon our interruption|request unsuccessful|bot (check|verification)|ddos-guard|captcha|client challenge/i;
const BOT_TEXT =
  /verify(ing)? (that )?you are (a )?human|checking (if the site connection is secure|your browser)|press (&|and) hold|enable javascript and cookies to continue|unusual traffic from your (computer|network)|are you a robot|complete the security check|why have i been blocked|needs to review the security of your connection|verify you are not a (robot|bot)|\bcaptcha\b|enter the characters (you see|seen)/i;
const LOGIN_URL = /(log|sign)[-_]?in|\/auth\b|\/sso\b|\/account\/?$/i;

export interface Block {
  kind: "bot check" | "login wall";
  why: string;
}

/** A page that is a bot check or a login wall rather than the content the agent asked for. */
export function detectBlock(p: PageData): Block | null {
  const short = p.text.length < 3000;
  const title = BOT_TITLE.exec(p.title);
  if (short && title) return { kind: "bot check", why: `title "${clip(p.title, 60)}"` };
  const text = BOT_TEXT.exec(p.text);
  if (short && text) return { kind: "bot check", why: `the page says "${clip(text[0], 60)}"` };
  if (p.signals?.challenge && p.text.length < 1500) return { kind: "bot check", why: "a challenge widget fills the page" };
  let path = "";
  try {
    path = new URL(p.url).pathname;
  } catch {
    // keep empty
  }
  if (p.signals?.hasPassword && p.text.length < 2500 && (LOGIN_URL.test(path) || /(log|sign)[ -]?in/i.test(p.title)))
    return { kind: "login wall", why: "the page is a sign-in form" };
  return null;
}

export interface RenderOptions {
  /** Shown when the engine holds several pages, so find/read can name one. */
  pageId?: string;
  /** The page map's fields for this page, when a map matched it. */
  map?: MapResult;
}

const fieldLine = (f: MapResult["fields"][number]): string =>
  `  ${f.name} = ${f.ok ? `${clip(f.value!, 200)}${f.unit ? ` ${f.unit}` : ""}` : "(none)"}`;

/** The result of open(url): everything an agent usually needs in one call. */
export function renderOpen(p: PageData, textBudget = 3000, opts: RenderOptions = {}): string {
  const lines = [`# ${p.title || "(untitled)"}`, `url: ${p.url}`];
  if (opts.pageId) lines.push(`page: ${opts.pageId}`);

  const block = detectBlock(p);
  if (block) {
    lines.push(
      `blocked: this looks like a ${block.kind} (${block.why}), not the page's content. The site did not serve the page to this browser; try another source.`,
      `[read(from=0) shows its ${p.text.length} chars of text anyway]`,
    );
    return lines.join("\n");
  }

  const m = opts.map;
  if (m) {
    const where = `${m.map.host} ${m.map.pattern}`;
    const good = m.fields.filter((f) => f.ok || (f.optional && f.reason === "missing"));
    if (m.ok) {
      lines.push(`page map: ${m.map.pageType} (${where}), ${m.fields.length} fields checked${m.repaired ? `, ${m.repaired.join(", ")} repaired just now` : ""}:`);
      lines.push(...m.fields.map(fieldLine));
      lines.push(`[text not shown (${p.text.length} chars): find(pattern) or read(from=0) for anything else; ${p.links.length} links]`);
      return lines.join("\n");
    }
    const failed = m.fields.filter((f) => !good.includes(f));
    lines.push(
      `page map: ${m.map.pageType} (${where}): ${good.length} of ${m.fields.length} fields checked; ` +
        `failed, so the page follows (the map may be stale): ${failed.map((f) => `${f.name} (${f.reason})`).join(", ")}`,
    );
    lines.push(...good.map(fieldLine));
  }
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

  const start = textStart(p);
  const end = start + cutText(p.text.slice(start), textBudget);
  const whole = start === 0 && end === p.text.length;
  if (whole) lines.push("text:");
  else if (start === 0) lines.push(`text (first ${end} of ${p.text.length} chars):`);
  else lines.push(`text (main content, chars ${start}-${end} of ${p.text.length}; site header before it: read(from=0)):`);
  lines.push(p.text.slice(start, end));
  if (end < p.text.length) lines.push(`[more: read(from=${end}); find(pattern) searches all text, ${p.links.length} links and JSON]`);
  else if (p.links.length) lines.push(`[${p.links.length} links: find(pattern) returns their URLs]`);
  return lines.join("\n");
}

const MAX_PATTERN = 300;
const FIND_BUDGET_MS = 2000;

/** find(pattern): matching lines from the text, links (with URLs), loaded JSON and structured data. */
export function findIn(p: PageData, pattern: string, max = 40, budgetMs = FIND_BUDGET_MS): string {
  if (pattern.length > MAX_PATTERN) throw new Error(`pattern is ${pattern.length} characters; keep it under ${MAX_PATTERN}`);
  let re: RegExp;
  try {
    re = new RegExp(pattern, "i");
  } catch {
    re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
  const hits: string[] = [];
  let total = 0;
  let checked = 0;
  let timedOut = false;
  const deadline = Date.now() + budgetMs;
  const add = (s: string) => {
    total++;
    if (hits.length < max) hits.push(s);
  };
  // A slow pattern on a large page must not hang the server; stop and say so.
  const scan = <T>(items: readonly T[], visit: (item: T, i: number) => void): void => {
    for (let i = 0; i < items.length && !timedOut; i++) {
      if (++checked % 500 === 0 && Date.now() > deadline) timedOut = true;
      else visit(items[i]!, i);
    }
  };
  const lines = linesOf(p);
  if (lines.doc) scan(lines.doc, (line) => re.test(line) && add(`doc ${around(line, re)}`));
  else scan(p.text.split("\n"), (line, i) => re.test(line) && add(`L${i + 1}: ${around(line, re)}`));
  scan(p.links, (l) => (re.test(l.text) || re.test(l.href)) && add(`link: ${l.text} -> ${l.href}`));
  lines.json.forEach((flat, i) => scan(flat, (line) => re.test(line) && add(`json#${i + 1} ${around(line, re)}`)));
  scan(lines.ld, (line) => re.test(line) && add(`ld ${around(line, re)}`));
  const note = timedOut ? `\n[search stopped after ${budgetMs} ms; results are partial, try a simpler pattern]` : "";
  if (!total) return `no matches for /${re.source}/i${note}`;
  return [`${total} matches for /${re.source}/i${total > max ? ` (showing ${max})` : ""}:`, ...hits].join("\n") + note;
}

/** read(from, length): the next slice of the page text. */
export function readText(p: PageData, from: number, length = 6000): string {
  const start = Math.max(0, Math.min(from, p.text.length));
  const end = start + cutText(p.text.slice(start), length);
  const more = end < p.text.length ? `\n[more: read(from=${end})]` : "\n[end of text]";
  return `text ${start}-${end} of ${p.text.length}:\n${p.text.slice(start, end)}${more}`;
}
