// One headless Chrome tab driven over raw CDP.
//
// open(url) navigates, waits for the load event and then for the network to go
// quiet (so data fetched after load is in), keeps every JSON response the page
// loaded, and extracts the page in a single Runtime.evaluate. Runtime.enable is
// never called: it is a common automation fingerprint and isn't needed here.
//
// The same load path serves actions (see act()): a click or form submit is the
// trigger instead of Page.navigate, and the result is read the same way.
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
  /**
   * Drive a browser that is already running instead of launching Chrome: a
   * ws:// DevTools endpoint or an http://host:port one (for example
   * `lightpanda serve` or `chrome --remote-debugging-port=9222`).
   */
  cdpUrl?: string;
  /** Also list the page's actionable elements (for the action tools). */
  withActions?: boolean;
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

/** A ws:// endpoint from either a ws:// URL or an http://host:port DevTools address. */
async function resolveEndpoint(url: string): Promise<string> {
  if (/^wss?:/i.test(url)) return url;
  const res = await fetch(new URL("/json/version", url));
  if (!res.ok) throw new Error(`${url}/json/version answered ${res.status}`);
  const { webSocketDebuggerUrl } = (await res.json()) as { webSocketDebuggerUrl?: string };
  if (!webSocketDebuggerUrl) throw new Error(`${url} did not report a webSocketDebuggerUrl`);
  return webSocketDebuggerUrl;
}

export class Browser {
  private constructor(
    private readonly chrome: Chrome | null,
    private readonly cdp: CdpConnection,
    private readonly sessionId: string,
    /** The tab's main frame (its id equals the target id), to tell the page from its iframes. */
    private readonly frameId: string,
    private readonly opts: BrowserOptions,
  ) {}

  static async launch(opts: BrowserOptions = {}): Promise<Browser> {
    const chrome = opts.cdpUrl ? null : await launchChrome(opts);
    try {
      const cdp = await CdpConnection.connect(chrome ? chrome.wsEndpoint : await resolveEndpoint(opts.cdpUrl!));
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
      await chrome?.kill();
      throw err;
    }
  }

  private send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.cdp.send<T>(method, params, this.sessionId);
  }

  open(url: string): Promise<PageData> {
    return this.load(url, async () => {
      const nav = await this.send<{ errorText?: string }>("Page.navigate", { url });
      // ERR_ABORTED is what Chrome reports when the page itself cancels the first
      // navigation (e.g. it redirects or swaps in a client-side view). Wait for
      // what loads instead of failing; other errors are real.
      if (nav.errorText && nav.errorText !== "net::ERR_ABORTED") throw new Error(`navigation to ${url} failed: ${nav.errorText}`);
    });
  }

  /**
   * Runs a script in the page that performs an action (a click, a form
   * submit), then reads the page as open() does. A navigation the action
   * starts is waited for; one it does not start is simply not waited for.
   */
  async act(script: string, previous: PageData): Promise<PageData> {
    const page = await this.load(previous.url, async () => {
      const r = await this.evaluate<{ ok: boolean; error?: string }>(script);
      if (!r.ok) throw new Error(r.error ?? "the action failed");
      // A click may start a navigation a moment later; give it time to show up.
      await new Promise((resolve) => setTimeout(resolve, 300));
    }, true);
    // Responses from before the action stay searchable; the page's new ones come first.
    const seen = new Set(page.json.map((j) => j.url));
    return { ...page, json: [...page.json, ...previous.json.filter((j) => !seen.has(j.url))].slice(0, MAX_JSON_RESPONSES) };
  }

  /**
   * `startUrl` is the page the tab is on before the trigger runs (to check the
   * hops against). With `inPlace`, no navigation is assumed: the page counts as
   * loaded until a main-frame document request starts.
   */
  private async load(startUrl: string, trigger: () => Promise<void>, inPlace = false): Promise<PageData> {
    const inflight = new Set<string>();
    const jsonRequests = new Map<string, { url: string; status: number }>();
    const bodyFetches: Promise<void>[] = [];
    const json: CapturedJson[] = [];
    let loaded = inPlace;
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
          if (params.type === "Document" && params.frameId === this.frameId) {
            documentUrls.push(params.request.url);
            if (inPlace) loaded = false; // a navigation started: wait for its load event
          }
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
      await trigger();
      await waitUntil(() => loaded || privateDocument !== null, this.opts.navigationTimeoutMs ?? 20_000);
      if (privateDocument === null)
        await waitUntil(() => inflight.size === 0 && Date.now() - lastActivity >= QUIET_MS, this.opts.settleTimeoutMs ?? 5_000);
      let refusal: Error | null =
        privateDocument === null
          ? null
          : new Error(`refused to read ${startUrl}: it was served from ${privateDocument}, a local or private address; ${PRIVATE_HINT}`);
      if (!refusal && !this.opts.allowPrivate) {
        // A public page can redirect to a private one; check every hop by name.
        const hops = [...new Map(documentUrls.filter((u) => /^https?:/i.test(u)).map((u) => [new URL(u).host, u])).values()];
        for (const hop of hops) {
          refusal = await assertPublicUrl(hop).then(
            () => null,
            (err: Error) => new Error(hop === startUrl ? err.message : `${startUrl} redirected: ${err.message}`),
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
      const raw = await this.evaluate<RawPage>(extractScript({ dropHidden: this.opts.dropHidden ?? true, withActions: this.opts.withActions }));
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
      // A browser we did not launch is left running; only our tab goes.
      await Promise.race([this.cdp.send(this.chrome ? "Browser.close" : "Target.closeTarget", this.chrome ? {} : { targetId: this.frameId }), new Promise((r) => setTimeout(r, 2000))]);
    } catch {
      // already gone
    }
    this.cdp.close();
    await this.chrome?.kill();
  }
}
