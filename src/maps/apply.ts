// The checker: reads each mapped field from a loaded page and checks it, in
// plain code with no model call. A field that is missing or the wrong kind of
// value fails and is never shown; the caller then falls back to the text view.
import { jsonDocument, parseJsonLd, type PageData } from "../page/view.ts";
import { matchPattern } from "./pattern.ts";
import type { FieldValue, Location, MapField, MapResult, PageMap } from "./types.ts";

type Step = { key: string } | { index: number } | { all: true };

/** Parses a.b[0].c, items[*].name and ["odd.key"] into steps. */
export function parsePath(path: string): Step[] {
  const steps: Step[] = [];
  const re = /\[(\d+)\]|\[\*\]|\["((?:[^"\\]|\\.)*)"\]|\.?([^.[\]]+)/gy;
  let m: RegExpExecArray | null;
  let at = 0;
  while (at < path.length && (m = re.exec(path))) {
    if (m[1] !== undefined) steps.push({ index: Number(m[1]) });
    else if (m[0] === "[*]") steps.push({ all: true });
    else if (m[2] !== undefined) steps.push({ key: JSON.parse(`"${m[2]}"`) as string });
    else steps.push({ key: m[3]! });
    at = re.lastIndex;
  }
  if (at !== path.length) throw new Error(`bad path "${path}"`);
  return steps;
}

/** The value at `path`; a [*] step returns an array of what follows it. */
export function getPath(value: unknown, path: string): unknown {
  const walk = (v: unknown, steps: Step[]): unknown => {
    if (!steps.length) return v;
    const [s, ...rest] = steps as [Step, ...Step[]];
    if ("all" in s) return Array.isArray(v) ? v.map((x) => walk(x, rest)).filter((x) => x !== undefined) : undefined;
    if (v === null || typeof v !== "object") return undefined;
    if ("index" in s) return Array.isArray(v) ? walk(v[s.index], rest) : undefined;
    return walk((v as Record<string, unknown>)[s.key], rest);
  };
  try {
    return walk(value, parsePath(path));
  } catch {
    return undefined;
  }
}

/** Nested quantifiers like (a+)+ can take exponential time on a long page; maps may not use them. */
export function unsafeRegex(source: string): boolean {
  return /\((?:[^()\\]|\\.)*[*+](?:[^()\\]|\\.)*\)[*+{]/.test(source);
}

function locate(at: Location, p: PageData): unknown {
  switch (at.from) {
    case "doc": {
      const doc = jsonDocument(p);
      return doc === undefined ? undefined : getPath(doc, at.path);
    }
    case "json": {
      for (const j of p.json) {
        if (!matchPattern(at.url, j.url)) continue;
        const v = getPath(j.data, at.path);
        if (v !== undefined) return v;
      }
      return undefined;
    }
    case "jsonld": {
      for (const block of parseJsonLd(p.jsonLd)) {
        const items = [block, ...(Array.isArray(block) ? block : []), ...(Array.isArray((block as { "@graph"?: unknown })?.["@graph"]) ? ((block as { "@graph": unknown[] })["@graph"]) : [])];
        for (const item of items) {
          const v = getPath(item, at.path);
          if (v !== undefined) return v;
        }
      }
      return undefined;
    }
    case "meta":
      return p.meta?.[at.name] || undefined;
    case "text": {
      if (unsafeRegex(at.regex)) return undefined;
      let re: RegExp;
      try {
        re = new RegExp(at.regex, "m");
      } catch {
        return undefined;
      }
      const m = re.exec(p.text);
      return m ? (m[1] ?? m[0]) : undefined;
    }
  }
}

/** A number standing on its own: "£1,299.50" yes, the 12 in "ab12cd" or "v1.2.3" no. */
const FIRST_NUMBER = /(?<![A-Za-z0-9.])-?\d[\d,]*(?:\.\d+)?(?![A-Za-z0-9]|\.\d)/;

/** "£1,299.50" -> "1299.50"; null when there is no number standing on its own. */
export function numberIn(s: string): string | null {
  const m = FIRST_NUMBER.exec(s);
  if (!m) return null;
  const n = m[0].replace(/,/g, "");
  return Number.isFinite(Number(n)) ? n : null;
}

const scalarText = (v: unknown): string | undefined => {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string") return v.replace(/\s+/g, " ").trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
};

/** Reads and checks one field. Returns the display value, or why it failed. */
export function readField(f: MapField, p: PageData): FieldValue {
  const base = { name: f.name, type: f.type, unit: f.unit, optional: f.optional };
  const fail = (reason: string): FieldValue => ({ ...base, ok: false, reason });
  const raw = locate(f.at, p);
  if (raw === undefined || raw === null || raw === "" || (Array.isArray(raw) && !raw.length)) return fail("missing");

  let value: string | undefined;
  if (f.type === "list") {
    const items = (Array.isArray(raw) ? raw : [raw]).map(scalarText).filter((x): x is string => !!x);
    if (!items.length) return fail("not a list of values");
    value = items.slice(0, 30).join(", ") + (items.length > 30 ? `, … (${items.length})` : "");
  } else {
    const text = scalarText(Array.isArray(raw) && raw.length === 1 ? raw[0] : raw);
    if (text === undefined || text === "") return fail("not a single value");
    switch (f.type) {
      case "number":
      case "integer": {
        const n = numberIn(text);
        if (n === null) return fail(`"${text.slice(0, 40)}" is not a number`);
        if (f.type === "integer" && !/^-?\d+$/.test(n)) return fail(`${n} is not a whole number`);
        value = n;
        break;
      }
      case "date":
        if (!/\b(1[89]|2[01])\d\d\b/.test(text) && Number.isNaN(Date.parse(text))) return fail(`"${text.slice(0, 40)}" is not a date`);
        value = text;
        break;
      case "url":
        try {
          value = new URL(text, p.url).href;
        } catch {
          return fail("not a URL");
        }
        if (!/^https?:/.test(value)) return fail("not a web URL");
        break;
      case "boolean":
        if (!/^(true|false|yes|no)$/i.test(text)) return fail(`"${text.slice(0, 40)}" is not true/false`);
        value = text.toLowerCase();
        break;
      default:
        if (text.length > 500) return fail("text too long for a field");
        value = text;
    }
  }
  if (f.shape) {
    try {
      if (!unsafeRegex(f.shape) && !new RegExp(f.shape).test(value)) return fail(`"${value.slice(0, 40)}" does not match ${f.shape}`);
    } catch {
      // a bad shape regex is ignored; the type check still applies
    }
  }
  return { ...base, ok: true, value };
}

/**
 * Applies a map to a page: every field read and checked. An optional field that
 * is missing is fine, unless it is named in `suspect` (the engine passes the
 * optional fields that were missing on several loads in a row: a location that
 * broke looks the same as a page that lacks the field).
 */
export function applyMap(map: PageMap, p: PageData, suspect: ReadonlySet<string> = new Set()): MapResult {
  const fields = map.fields.map((f) => {
    const v = readField(f, p);
    return { ...v, fatal: !v.ok && !(f.optional && v.reason === "missing" && !suspect.has(f.name)) };
  });
  return { map, fields, ok: fields.every((f) => !f.fatal) };
}

/** Same value, allowing for number formatting and whitespace: used to check a map against its own example. */
export function sameValue(type: MapField["type"], a: string, b: string): boolean {
  if (type === "number" || type === "integer") {
    const x = numberIn(a);
    const y = numberIn(b);
    return x !== null && y !== null && Number(x) === Number(y);
  }
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  if (norm(a) === norm(b)) return true;
  // Models shorten long examples ("It's hard to imagine…"); a long enough prefix is the same value.
  const prefix = norm(b).replace(/(…|\.\.\.)$/, "").replace(/, ….*$/, "");
  return (type === "list" || type === "string") && prefix.length >= 30 && norm(a).startsWith(prefix);
}
