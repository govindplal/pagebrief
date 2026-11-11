// One headless Chrome tab driven over raw CDP.
//
// open(url) navigates, waits for the load event and then for the network to go
// quiet (so data fetched after load is in), keeps every JSON response the page
// loaded, and extracts the page in a single Runtime.evaluate. Runtime.enable is
// never called: it is a common automation fingerprint and isn't needed here.
import { launchChrome, type Chrome, type LaunchOptions } from "./cdp/chrome.ts";
import { CdpConnection } from "./cdp/connection.ts";
import { assertPublicUrl, isPrivateAddress, PRIVATE_HINT, usesProxyEnv } from "./net/guard.ts";
import { extractScript } from "./page/extract-script.ts";
import { rankJson } from "./page/json-rank.ts";
import type { CapturedJson, PageData, RawPage } from "./page/view.ts";

export interface BrowserOptions extends LaunchOptions {
  /** Max wait for the load event; the page is read as-is after that. */
  navigationTimeoutMs?: number;
  /** Max extra wait for the network to go quiet after load. */
  settleTimeoutMs?: number;
  /** Allow pages served from this machine or a private network (off by default). */
  allowPrivate?: boolean;
  /**
   * Refuse a page whose connection went to a private address (catches DNS
   * answers that point inward). Behind a proxy every connection goes to the
   * proxy's address, so this defaults to off when a proxy variable is set.
   */
  checkRemoteAddress?: boolean;
  /** Drop rendered but invisible text (zero opacity, zero font size, off screen). On by default. */
  dropHidden?: boolean;
}

const MAX_JSON_BYTES = 2_000_000;
/** JSON responses kept per page, chosen by rankJson from up to MAX_JSON_CANDIDATES. */
const MAX_JSON_RESPONSES = 20;
const MAX_JSON_CANDIDATES = 60;
const QUIET_MS = 500;
/** Requests that stay open by design; waiting for them would always hit the settle cap. */
const BACKGROUND_TYPES = new Set(["EventSource", "WebSocket", "Ping", "Media", "CSPViolationReport"]);

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
    /** The tab's main frame (its id equals the target id), to tell the page from its iframes. */
    private readonly frameId: string,
    private readonly opts: BrowserOptions,
  ) {}

  static async launch(opts: BrowserOptions = {}): Promise<Browser> {
    const chrome = await launchChrome(opts);
    try {
      const cdp = await CdpConnection.connect(chrome.wsEndpoint);
      const { targetId } = await cdp.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
      const browser = new Browser(chrome, cdp, sessionId, targetId, opts);
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
    // Set when the page itself (after redirects, or through DNS) was served from a private address.
    let privateDocument: string | null = null;
    // Every URL the tab's own document went through, redirects included.
    const documentUrls: string[] = [];
    const checkRemote = !this.opts.allowPrivate && (this.opts.checkRemoteAddress ?? !usesProxyEnv());

    const off = this.cdp.onEvent(({ method, params, sessionId }) => {
      if (sessionId !== this.sessionId) return;
      switch (method) {
        case "Network.requestWillBeSent":
          if (params.type === "Document" && params.frameId === this.frameId) documentUrls.push(params.request.url);
          if (BACKGROUND_TYPES.has(params.type)) break;
          inflight.add(params.requestId);
          lastActivity = Date.now();
          break;
        case "Network.responseReceived": {
          const remote: string = params.response?.remoteIPAddress ?? "";
          const isPrivate = checkRemote && remote !== "" && isPrivateAddress(remote);
          if (isPrivate && params.type === "Document" && params.frameId === this.frameId) privateDocument = remote;
          if (!isPrivate && /json/i.test(params.response?.mimeType ?? "") && jsonRequests.size < MAX_JSON_CANDIDATES)
            jsonRequests.set(params.requestId, { url: params.response.url, status: params.response.status });
          break;
        }
        case "Network.loadingFinished": {
          inflight.delete(params.requestId);
          lastActivity = Date.now();
          const req = jsonRequests.get(params.requestId);
          // encodedDataLength is the size on the wire (compressed); captureJson checks the decoded size.
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
      // ERR_ABORTED is what Chrome reports when the page itself cancels the first
      // navigation (e.g. it redirects or swaps in a client-side view). Wait for
      // what loads instead of failing; other errors are real.
      if (nav.errorText && nav.errorText !== "net::ERR_ABORTED") throw new Error(`navigation to ${url} failed: ${nav.errorText}`);
      await waitUntil(() => loaded || privateDocument !== null, this.opts.navigationTimeoutMs ?? 20_000);
      if (privateDocument === null)
        await waitUntil(() => inflight.size === 0 && Date.now() - lastActivity >= QUIET_MS, this.opts.settleTimeoutMs ?? 5_000);
      let refusal: Error | null =
        privateDocument === null
          ? null
          : new Error(`refused to read ${url}: it was served from ${privateDocument}, a local or private address; ${PRIVATE_HINT}`);
      if (!refusal && !this.opts.allowPrivate) {
        // A public page can redirect to a private one; check every hop by name.
        const hops = [...new Map(documentUrls.filter((u) => /^https?:/i.test(u)).map((u) => [new URL(u).host, u])).values()];
        for (const hop of hops) {
          refusal = await assertPublicUrl(hop).then(
            () => null,
            (err: Error) => new Error(hop === url ? err.message : `${url} redirected: ${err.message}`),
          );
          if (refusal) break;
        }
      }
      if (refusal) {
        // Leave the page before reporting, so nothing read from it reaches the agent.
        await this.send("Page.navigate", { url: "about:blank" }).catch(() => {});
        throw refusal;
      }
      await Promise.allSettled(bodyFetches);
      const raw = await this.evaluate<RawPage>(extractScript({ dropHidden: this.opts.dropHidden ?? true }));
      return { ...raw, json: rankJson(json, raw.url, MAX_JSON_RESPONSES) };
    } finally {
      off();
    }
  }

  private async captureJson(requestId: string, req: { url: string; status: number }, into: CapturedJson[]): Promise<void> {
    try {
      const { body, base64Encoded } = await this.send<{ body: string; base64Encoded: boolean }>("Network.getResponseBody", { requestId });
      const text = base64Encoded ? Buffer.from(body, "base64").toString("utf8") : body;
      if (text.length > MAX_JSON_BYTES) return;
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
