// The agent-facing operations, independent of transport (MCP, CLI, tests).
// The browser starts lazily on the first open() and is reused after that.
import { Browser, type BrowserOptions } from "./browser.ts";
import { applyMap } from "./maps/apply.ts";
import { hostKey } from "./maps/pattern.ts";
import type { MapStore } from "./maps/store.ts";
import type { MapRepairer } from "./maps/student.ts";
import type { MapTeacher, TeachResult } from "./maps/teacher.ts";
import type { MapResult } from "./maps/types.ts";
import { assertPublicUrl } from "./net/guard.ts";
import { detectBlock, findIn, readText, renderOpen, type PageData } from "./page/view.ts";

export interface MapOptions {
  store: MapStore;
  /** Writes maps for page types that have none (a large model). */
  teacher?: MapTeacher;
  /** Teach in the background after an open() of a page type with no map. Off: maps are only read. */
  learn?: boolean;
  /** Repairs a map that fails its check (a small model). Off: the text view is shown instead. */
  repairer?: MapRepairer;
  /** Max wait for a repair before showing the text view. */
  repairTimeoutMs?: number;
}

export interface EngineOptions extends BrowserOptions {
  /** Characters of page text returned by open(); the rest is reachable via read/find. */
  textBudget?: number;
  /** Pages kept for find/read, most recent first. */
  keepPages?: number;
  maps?: MapOptions;
}

interface HeldPage {
  id: string;
  data: PageData;
  map?: MapResult;
}

/** What happened with maps on each open(), for the benchmark's map evaluation. */
export interface MapEvent {
  url: string;
  kind: "hit" | "broken" | "repaired" | "repair_failed" | "none" | "taught" | "teach_failed" | "blocked";
  pattern?: string;
  failed?: string[];
  detail?: string;
}

export class Engine {
  #browser: Promise<Browser> | null = null;
  #pages: HeldPage[] = [];
  #nextId = 1;
  /** Opens run one at a time: there is one tab, and agents often send tool calls in parallel. */
  #queue: Promise<unknown> = Promise.resolve();
  #teaching = new Map<string, Promise<TeachResult | null>>();
  /** Set while the latest open() failed, so find/read never answer from an older page by mistake. */
  #lastFailed: string | null = null;
  /** Recent map outcomes, newest last. */
  readonly mapEvents: MapEvent[] = [];

  constructor(private readonly opts: EngineOptions = {}) {}

  #getBrowser(): Promise<Browser> {
    this.#browser ??= Browser.launch(this.opts).catch((err: unknown) => {
      this.#browser = null;
      throw err;
    });
    return this.#browser;
  }

  /** A held page by id ("p2") or URL; the last opened one by default. */
  #pick(page?: string): HeldPage {
    if (!this.#pages.length) throw new Error("no page is open; call open(url) first");
    if (!page && this.#lastFailed)
      throw new Error(
        `open(${this.#lastFailed}) failed, so there is no current page; call open(url) first, or pass page= one of: ${this.#pages.map((p) => `${p.id} ${p.data.url}`).join(", ")}`,
      );
    if (!page) return this.#pages[0]!;
    const found = this.#pages.find((p) => p.id === page || p.data.url === page);
    if (!found) throw new Error(`no open page "${page}"; open pages: ${this.#pages.map((p) => `${p.id} ${p.data.url}`).join(", ")}`);
    return found;
  }

  /** The last opened page's data, for tests and debugging. */
  get page(): PageData | null {
    return this.#pages[0]?.data ?? null;
  }

  open(url: string): Promise<string> {
    const run = this.#queue.then(() =>
      this.#open(url).then(
        (view) => {
          this.#lastFailed = null;
          return view;
        },
        (err: unknown) => {
          this.#lastFailed = url;
          throw err;
        },
      ),
    );
    this.#queue = run.catch(() => {});
    return run;
  }

  async #open(url: string): Promise<string> {
    if (!/^https?:\/\//i.test(url)) throw new Error(`expected an absolute http(s) URL, got "${url}"`);
    if (!this.opts.allowPrivate) await assertPublicUrl(url);
    const browser = await this.#getBrowser();
    const data = await browser.open(url);
    const held: HeldPage = { id: `p${this.#nextId++}`, data };
    held.map = await this.#mapFor(data);
    this.#pages = [held, ...this.#pages].slice(0, Math.max(1, this.opts.keepPages ?? 5));
    return renderOpen(data, this.opts.textBudget, { map: held.map, pageId: this.#pages.length > 1 ? held.id : undefined });
  }

  async #mapFor(data: PageData): Promise<MapResult | undefined> {
    const m = this.opts.maps;
    if (!m) return undefined;
    if (detectBlock(data)) {
      this.#event({ url: data.url, kind: "blocked" });
      return undefined;
    }
    const map = m.store.find(data.url);
    if (!map) {
      this.#event({ url: data.url, kind: "none" });
      if (m.learn && m.teacher) void this.teach(data);
      return undefined;
    }
    const result = applyMap(map, data);
    const failed = result.fields.filter((f) => !f.ok && !(f.optional && f.reason === "missing")).map((f) => f.name);
    if (result.ok) {
      this.#event({ url: data.url, kind: "hit", pattern: map.pattern });
      return result;
    }
    this.#event({ url: data.url, kind: "broken", pattern: map.pattern, failed });
    if (!m.repairer) return result;
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), m.repairTimeoutMs ?? 60_000).unref());
    const repaired = await Promise.race([m.repairer.repair(result, data).catch(() => null), timeout]);
    if (!repaired) {
      this.#event({ url: data.url, kind: "repair_failed", pattern: map.pattern, failed });
      return result;
    }
    m.store.save(repaired);
    this.#event({ url: data.url, kind: "repaired", pattern: map.pattern, failed });
    return { ...applyMap(repaired, data), repaired: failed };
  }

  /** Writes a map for this page's type (one teaching per site at a time) and saves it. */
  teach(data: PageData): Promise<TeachResult | null> {
    const m = this.opts.maps;
    if (!m?.teacher) return Promise.reject(new Error("no teacher configured"));
    const key = hostKey(data.url);
    const running = this.#teaching.get(key);
    if (running) return running;
    const job = m.teacher
      .teach(data)
      .then((r) => {
        m.store.save(r.map);
        this.#event({ url: data.url, kind: "taught", pattern: r.map.pattern });
        return r;
      })
      .catch((err: unknown) => {
        this.#event({ url: data.url, kind: "teach_failed", detail: err instanceof Error ? err.message : String(err) });
        return null;
      })
      .finally(() => this.#teaching.delete(key));
    this.#teaching.set(key, job);
    return job;
  }

  /** Opens a page and writes its map, waiting for the teacher. For the CLI and the benchmark. */
  async learn(url: string): Promise<TeachResult> {
    await this.open(url);
    const data = this.#pick().data;
    const block = detectBlock(data);
    if (block) throw new Error(`${url} is a ${block.kind}; nothing to map`);
    const m = this.opts.maps;
    if (!m?.teacher) throw new Error("no teacher configured");
    const r = await m.teacher.teach(data);
    m.store.save(r.map);
    return r;
  }

  #event(e: MapEvent): void {
    this.mapEvents.push(e);
    if (this.mapEvents.length > 1000) this.mapEvents.splice(0, this.mapEvents.length - 1000);
  }

  #header(p: HeldPage): string {
    return this.#pages.length > 1 ? `page ${p.id}: ${p.data.url}\n` : "";
  }

  find(pattern: string, page?: string): string {
    const p = this.#pick(page);
    return this.#header(p) + findIn(p.data, pattern);
  }

  read(from: number, length?: number, page?: string): string {
    const p = this.#pick(page);
    return this.#header(p) + readText(p.data, from, length);
  }

  async close(): Promise<void> {
    const pending = this.#browser;
    this.#browser = null;
    this.#pages = [];
    await Promise.allSettled(this.#teaching.values());
    if (pending) await (await pending.catch(() => null))?.close();
  }
}
