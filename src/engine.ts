// The agent-facing operations, independent of transport (MCP, CLI, tests).
// The browser starts lazily on the first open() and is reused after that.
import { Browser, type BrowserOptions } from "./browser.ts";
import { findIn, readText, renderOpen, type PageData } from "./page/view.ts";

export interface EngineOptions extends BrowserOptions {
  /** Characters of page text returned by open(); the rest is reachable via read/find. */
  textBudget?: number;
}

export class Engine {
  #browser: Promise<Browser> | null = null;
  #page: PageData | null = null;

  constructor(private readonly opts: EngineOptions = {}) {}

  #getBrowser(): Promise<Browser> {
    this.#browser ??= Browser.launch(this.opts).catch((err: unknown) => {
      this.#browser = null;
      throw err;
    });
    return this.#browser;
  }

  #requirePage(): PageData {
    if (!this.#page) throw new Error("no page is open; call open(url) first");
    return this.#page;
  }

  /** The last opened page's data, for tests and debugging. */
  get page(): PageData | null {
    return this.#page;
  }

  async open(url: string): Promise<string> {
    if (!/^https?:\/\//i.test(url)) throw new Error(`expected an absolute http(s) URL, got "${url}"`);
    const browser = await this.#getBrowser();
    this.#page = await browser.open(url);
    return renderOpen(this.#page, this.opts.textBudget);
  }

  find(pattern: string): string {
    return findIn(this.#requirePage(), pattern);
  }

  read(from: number, length?: number): string {
    return readText(this.#requirePage(), from, length);
  }

  async close(): Promise<void> {
    const pending = this.#browser;
    this.#browser = null;
    this.#page = null;
    if (pending) await (await pending.catch(() => null))?.close();
  }
}
