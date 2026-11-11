// Where maps live: one JSON file per site in a local folder (default
// ~/.pagebrief/maps). Maps never leave the machine.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hostKey, matchPattern, specificity } from "./pattern.ts";
import { PageMapSchema, type PageMap } from "./types.ts";

export interface MapStore {
  /** The most specific map whose pattern matches the URL, if any. */
  find(url: string): PageMap | undefined;
  save(map: PageMap): void;
  list(): PageMap[];
}

export const defaultMapsDir = (): string => process.env.PAGEBRIEF_MAPS_DIR || path.join(os.homedir(), ".pagebrief", "maps");

const fileName = (host: string): string => `${host.replace(/[^a-z0-9.-]/gi, "_")}.json`;

interface SiteFile {
  host: string;
  maps: PageMap[];
}

export class FileMapStore implements MapStore {
  #cache = new Map<string, { mtimeMs: number; maps: PageMap[] }>();

  constructor(readonly dir: string = defaultMapsDir()) {}

  #load(host: string): PageMap[] {
    const file = path.join(this.dir, fileName(host));
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      return [];
    }
    const cached = this.#cache.get(host);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.maps;
    let maps: PageMap[] = [];
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as SiteFile;
      // A map that no longer fits the schema is skipped, not trusted.
      maps = (raw.maps ?? []).flatMap((m) => {
        const r = PageMapSchema.safeParse(m);
        return r.success ? [r.data] : [];
      });
    } catch {
      maps = [];
    }
    this.#cache.set(host, { mtimeMs: stat.mtimeMs, maps });
    return maps;
  }

  find(url: string): PageMap | undefined {
    let host: string;
    try {
      host = hostKey(url);
    } catch {
      return undefined;
    }
    return this.#load(host)
      .filter((m) => matchPattern(m.pattern, url))
      .sort((a, b) => specificity(b.pattern) - specificity(a.pattern))[0];
  }

  save(map: PageMap): void {
    const maps = this.#load(map.host).filter((m) => m.pattern !== map.pattern);
    maps.push(PageMapSchema.parse(map));
    fs.mkdirSync(this.dir, { recursive: true });
    const file = path.join(this.dir, fileName(map.host));
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ host: map.host, maps } satisfies SiteFile, null, 2) + "\n");
    fs.renameSync(tmp, file);
    this.#cache.delete(map.host);
  }

  list(): PageMap[] {
    let files: string[];
    try {
      files = fs.readdirSync(this.dir).filter((f) => f.endsWith(".json"));
    } catch {
      return [];
    }
    return files.flatMap((f) => this.#load(f.replace(/\.json$/, "")));
  }
}
