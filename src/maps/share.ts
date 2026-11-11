// Sharing maps: a bundle is a JSON file of page maps for public pages, which
// someone can publish like a filter list. A shared map is never trusted. It is
// schema-checked and screened on import, it can be verified against the live
// page it was written from, and every load is still checked in code before a
// value is shown. The weak point stays: a map can point at a real, well-formed
// value of the wrong thing (a "price" that is really a shipping fee), and no
// code check can tell. Imports are therefore marked, never replace a map you
// wrote, and should be reviewed before use.
import { isPrivateAddress } from "../net/guard.ts";
import type { PageData } from "../page/view.ts";
import { applyMap, sameValue, unsafeRegex } from "./apply.ts";
import { matchPattern } from "./pattern.ts";
import type { MapStore } from "./store.ts";
import { PageMapSchema, type PageMap } from "./types.ts";

export const BUNDLE_FORMAT = "pagebrief-maps/1";

export interface MapBundle {
  format: typeof BUNDLE_FORMAT;
  createdAt: string;
  maps: PageMap[];
}

const LOCAL_NAME = /^(localhost|.*\.local|.*\.internal|.*\.lan|.*\.home\.arpa)$/i;

/** A host that only exists on this machine or this network: its maps are not for sharing. */
export function isLocalHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "");
  return LOCAL_NAME.test(h) || !h.includes(".") || isPrivateAddress(h);
}

/** Maps for public hosts, ready to publish. Maps of local or private hosts are left out and named. */
export function exportMaps(store: MapStore, host?: string): { bundle: MapBundle; skipped: string[] } {
  const skipped: string[] = [];
  const maps = store
    .list()
    .filter((m) => !host || m.host === host)
    .filter((m) => {
      if (!isLocalHost(m.host)) return true;
      skipped.push(`${m.host}${m.pattern} (local or private host)`);
      return false;
    })
    // A shared map says nothing about who wrote it or what it cost.
    .map(({ teacher: _t, repairs: _r, importedFrom: _i, ...m }) => ({ ...m, source: m.source === "student" ? "teacher" : m.source }) as PageMap);
  return { bundle: { format: BUNDLE_FORMAT, createdAt: new Date().toISOString(), maps }, skipped };
}

export interface ImportReport {
  imported: string[];
  rejected: { map: string; why: string }[];
}

/** Why a map from a bundle must not be used, or null. */
export function screenMap(m: PageMap): string | null {
  if (isLocalHost(m.host)) return "local or private host";
  if (!m.pattern.startsWith("/")) return "pattern must start with /";
  if (m.pattern === "/**" && m.fields.length > 0 && m.pageType.trim() === "") return "a catch-all pattern needs a page type";
  try {
    if (!matchPattern(m.pattern, m.exampleUrl)) return "the pattern does not match the map's own example URL";
    if (new URL(m.exampleUrl).hostname.replace(/^www\./, "") !== m.host) return "the example URL is on a different host";
  } catch {
    return "bad example URL";
  }
  for (const f of m.fields) {
    if (f.at.from === "text") {
      if (unsafeRegex(f.at.regex)) return `field ${f.name}: regex with nested quantifiers`;
      try {
        new RegExp(f.at.regex, "m");
      } catch {
        return `field ${f.name}: invalid regex`;
      }
    }
    if (f.shape && unsafeRegex(f.shape)) return `field ${f.name}: shape regex with nested quantifiers`;
  }
  return null;
}

/**
 * Adds a bundle's maps to the store, marked as imported. A map you already
 * have for the same site and pattern is kept unless `replace` is set.
 */
export async function importMaps(
  raw: unknown,
  store: MapStore,
  opts: { from: string; replace?: boolean; verify?: (m: PageMap) => Promise<{ map: PageMap | null; dropped: { name: string; why: string }[] }> },
): Promise<ImportReport> {
  const report: ImportReport = { imported: [], rejected: [] };
  const b = raw as Partial<MapBundle> | null;
  if (!b || b.format !== BUNDLE_FORMAT || !Array.isArray(b.maps)) throw new Error(`not a ${BUNDLE_FORMAT} bundle`);
  for (const candidate of b.maps) {
    const label = `${(candidate as { host?: string })?.host ?? "?"}${(candidate as { pattern?: string })?.pattern ?? ""}`;
    const parsed = PageMapSchema.safeParse(candidate);
    if (!parsed.success) {
      report.rejected.push({ map: label, why: `invalid: ${parsed.error.issues[0]?.message ?? "schema"}` });
      continue;
    }
    const why = screenMap(parsed.data);
    if (why) {
      report.rejected.push({ map: label, why });
      continue;
    }
    const existing = store.list().find((m) => m.host === parsed.data.host && m.pattern === parsed.data.pattern);
    if (existing && !opts.replace) {
      report.rejected.push({ map: label, why: `you already have a ${existing.source} map for this page type; use --replace to overwrite` });
      continue;
    }
    let map = parsed.data;
    if (opts.verify) {
      const v = await opts.verify(map).catch((err: unknown) => ({ map: null, dropped: [{ name: "*", why: err instanceof Error ? err.message : String(err) }] }));
      if (!v.map) {
        report.rejected.push({ map: label, why: `verification failed: ${v.dropped.map((d) => `${d.name} (${d.why})`).join("; ")}` });
        continue;
      }
      if (v.dropped.length) report.rejected.push({ map: label, why: `kept ${v.map.fields.length} of ${map.fields.length} fields; dropped ${v.dropped.map((d) => `${d.name} (${d.why})`).join("; ")}` });
      map = v.map;
    }
    store.save({ ...map, source: "imported", importedFrom: opts.from, teacher: undefined, repairs: undefined });
    report.imported.push(label);
  }
  return report;
}

/**
 * Checks a map against the page it was written from, as loaded now: a field
 * stays only if it reads and checks, and still holds the example value. Values
 * that changed since (a price, a count) drop their field; that is conservative.
 */
export function verifyMap(map: PageMap, page: PageData): { map: PageMap | null; dropped: { name: string; why: string }[] } {
  const res = applyMap(map, page);
  const dropped: { name: string; why: string }[] = [];
  const keep = map.fields.filter((f) => {
    const v = res.fields.find((x) => x.name === f.name)!;
    if (!v.ok) {
      dropped.push({ name: f.name, why: v.reason ?? "failed" });
      return false;
    }
    if (!sameValue(f.type, v.value!, f.example)) {
      dropped.push({ name: f.name, why: `reads "${v.value!.slice(0, 40)}", the map says "${f.example.slice(0, 40)}"` });
      return false;
    }
    return true;
  });
  return { map: keep.length ? { ...map, fields: keep } : null, dropped };
}
