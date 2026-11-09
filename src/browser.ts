// One headless Chrome tab driven over raw CDP.
//
// open(url) navigates, waits for the load event and then for the network to go
// quiet (so data fetched after load is in), keeps every JSON response the page
// loaded, and extracts the page in a single Runtime.evaluate. Runtime.enable is
// never called: it is a common automation fingerprint and isn't needed here.
import { launchChrome, type Chrome, type LaunchOptions } from "./cdp/chrome.ts";
import { CdpConnection } from "./cdp/connection.ts";
import { EXTRACT_SCRIPT } from "./page/extract-script.ts";
import type { CapturedJson, PageData, RawPage } from "./page/view.ts";

export interface BrowserOptions extends LaunchOptions {
  /** Max wait for the load event; the page is read as-is after that. */
  navigationTimeoutMs?: number;
  /** Max extra wait for the network to go quiet after load. */
  settleTimeoutMs?: number;
}

const MAX_JSON_BYTES = 2_000_000;
const MAX_JSON_RESPONSES = 20;
const QUIET_MS = 500;

async function waitUntil(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() >= end) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
  return true;
}

export class Browser {
  private constructor(
    private readonly chrome: Chrome,
    private readonly cdp: CdpConnection,
    private readonly sessionId: string,
    private readonly opts: BrowserOptions,
  ) {}

  static async launch(opts: BrowserOptions = {}): Promise<Browser> {
    const chrome = await launchChrome(opts);
    try {
      const cdp = await CdpConnection.connect(chrome.wsEndpoint);
      const { targetId } = await cdp.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
      const browser = new Browser(chrome, cdp, sessionId, opts);
      const { userAgent } = await cdp.send<{ userAgent: string }>("Browser.getVersion");
      await Promise.all([
        browser.send("Page.enable"),
        browser.send("Network.enable"),
        // Report the same user agent a regular Chrome would.
        browser.send("Network.setUserAgentOverride", { userAgent: userAgent.replace("HeadlessChrome", "Chrome") }),
      ]);
      return browser;
    } catch (err) {
      await chrome.kill();
      throw err;
    }
  }

  private send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.cdp.send<T>(method, params, this.sessionId);
  }

  async open(url: string): Promise<PageData> {
    const inflight = new Set<string>();
    const jsonRequests = new Map<string, { url: string; status: number }>();
    const bodyFetches: Promise<void>[] = [];
    const json: CapturedJson[] = [];
    let loaded = false;
    let lastActivity = Date.now();

    const off = this.cdp.onEvent(({ method, params, sessionId }) => {
      if (sessionId !== this.sessionId) return;
      switch (method) {
        case "Network.requestWillBeSent":
          inflight.add(params.requestId);
          lastActivity = Date.now();
          break;
        case "Network.responseReceived":
          if (/json/i.test(params.response?.mimeType ?? "") && jsonRequests.size < MAX_JSON_RESPONSES)
            jsonRequests.set(params.requestId, { url: params.response.url, status: params.response.status });
          break;
        case "Network.loadingFinished": {
          inflight.delete(params.requestId);
          lastActivity = Date.now();
          const req = jsonRequests.get(params.requestId);
          if (req && params.encodedDataLength <= MAX_JSON_BYTES) bodyFetches.push(this.captureJson(params.requestId, req, json));
          break;
        }
        case "Network.loadingFailed":
          inflight.delete(params.requestId);
          lastActivity = Date.now();
          break;
        case "Page.loadEventFired":
          loaded = true;
          break;
      }
    });

    try {
      const nav = await this.send<{ errorText?: string }>("Page.navigate", { url });
      if (nav.errorText) throw new Error(`navigation to ${url} failed: ${nav.errorText}`);
      await waitUntil(() => loaded, this.opts.navigationTimeoutMs ?? 20_000);
      await waitUntil(() => inflight.size === 0 && Date.now() - lastActivity >= QUIET_MS, this.opts.settleTimeoutMs ?? 5_000);
      await Promise.allSettled(bodyFetches);
      const raw = await this.evaluate<RawPage>(EXTRACT_SCRIPT);
      return { ...raw, json };
    } finally {
      off();
    }
  }

  private async captureJson(requestId: string, req: { url: string; status: number }, into: CapturedJson[]): Promise<void> {
    try {
      const { body, base64Encoded } = await this.send<{ body: string; base64Encoded: boolean }>("Network.getResponseBody", { requestId });
      const text = base64Encoded ? Buffer.from(body, "base64").toString("utf8") : body;
      into.push({ url: req.url, status: req.status, data: JSON.parse(text) });
    } catch {
      // body evicted, not JSON after all, or the page navigated away
    }
  }

  async evaluate<T>(expression: string): Promise<T> {
    const r = await this.send<{ result: { value?: unknown }; exceptionDetails?: { text: string; exception?: { description?: string } } }>(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
    );
    if (r.exceptionDetails) throw new Error(`page script failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value as T;
  }

  async close(): Promise<void> {
    try {
      await Promise.race([this.cdp.send("Browser.close"), new Promise((r) => setTimeout(r, 2000))]);
    } catch {
      // already gone
    }
    this.cdp.close();
    await this.chrome.kill();
  }
}
