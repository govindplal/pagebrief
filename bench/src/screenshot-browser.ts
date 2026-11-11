// The screenshot baseline: a browser an agent sees only through pictures, the
// way vision-based computer-use agents work. Every tool returns a screenshot of
// the page (and its URL and title); the agent reads text off the image and acts
// with coordinates. Same installed Chrome, same CDP client as the rest of the
// repo; no page text, no DOM, no JSON reaches the agent.
//   goto(url)  scroll(pixels)  click(x, y)  type(text, submit?)
import { launchChrome, type Chrome } from "../../src/cdp/chrome.ts";
import { CdpConnection } from "../../src/cdp/connection.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";

const WIDTH = 1024;
const HEIGHT = 768;

let state: Promise<{ chrome: Chrome; cdp: CdpConnection; sessionId: string }> | null = null;

function session() {
  state ??= (async () => {
    const chrome = await launchChrome({});
    const cdp = await CdpConnection.connect(chrome.wsEndpoint);
    const { targetId } = await cdp.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
    const send = (method: string, params: Record<string, unknown> = {}) => cdp.send(method, params, sessionId);
    const { userAgent } = await cdp.send<{ userAgent: string }>("Browser.getVersion");
    await Promise.all([
      send("Page.enable"),
      send("Network.setUserAgentOverride", { userAgent: userAgent.replace("HeadlessChrome", "Chrome") }),
      send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false }),
    ]);
    return { chrome, cdp, sessionId };
  })();
  return state;
}

async function snapshot(note: string) {
  const { cdp, sessionId } = await session();
  const send = <T = unknown>(method: string, params: Record<string, unknown> = {}) => cdp.send<T>(method, params, sessionId);
  // Let the page settle a moment after an action.
  await new Promise((r) => setTimeout(r, 800));
  const shot = await send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 60 });
  const info = await send<{ result: { value: { url: string; title: string; y: number; h: number } } }>("Runtime.evaluate", {
    expression: "({ url: location.href, title: document.title, y: Math.round(scrollY), h: document.documentElement.scrollHeight })",
    returnByValue: true,
  });
  const v = info.result.value;
  return {
    content: [
      { type: "image" as const, data: shot.data, mimeType: "image/jpeg" },
      { type: "text" as const, text: `${note}\nurl: ${v.url}\ntitle: ${v.title}\nscroll: ${v.y} of ${v.h} px (viewport ${WIDTH}x${HEIGHT})` },
    ],
  };
}

async function guard<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    return { content: [{ type: "text" as const, text: `error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
  }
}

const server = new McpServer({ name: "screenshot-browser", version: "1.0.0" });

server.registerTool(
  "goto",
  { description: "Open a URL and return a screenshot of the page.", inputSchema: { url: z.string() }, annotations: { readOnlyHint: true, openWorldHint: true } },
  ({ url }) =>
    guard(async () => {
      const { cdp, sessionId } = await session();
      const nav = await cdp.send<{ errorText?: string }>("Page.navigate", { url }, sessionId);
      if (nav.errorText && nav.errorText !== "net::ERR_ABORTED") throw new Error(`navigation failed: ${nav.errorText}`);
      await new Promise((r) => setTimeout(r, 1500));
      return snapshot(`opened ${url}`);
    }),
);
server.registerTool(
  "scroll",
  { description: "Scroll the page down (positive) or up (negative) by pixels and return a screenshot.", inputSchema: { pixels: z.number() }, annotations: { readOnlyHint: true } },
  ({ pixels }) =>
    guard(async () => {
      const { cdp, sessionId } = await session();
      await cdp.send("Runtime.evaluate", { expression: `window.scrollBy(0, ${Math.round(pixels)})` }, sessionId);
      return snapshot(`scrolled ${pixels}px`);
    }),
);
server.registerTool(
  "click",
  { description: "Click at screenshot coordinates (x, y) and return a screenshot.", inputSchema: { x: z.number(), y: z.number() }, annotations: { readOnlyHint: false, openWorldHint: true } },
  ({ x, y }) =>
    guard(async () => {
      const { cdp, sessionId } = await session();
      for (const type of ["mousePressed", "mouseReleased"])
        await cdp.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }, sessionId);
      await new Promise((r) => setTimeout(r, 1000));
      return snapshot(`clicked (${x}, ${y})`);
    }),
);
server.registerTool(
  "type",
  { description: "Type text into the focused field; submit presses Enter. Returns a screenshot.", inputSchema: { text: z.string(), submit: z.boolean().optional() }, annotations: { readOnlyHint: false } },
  ({ text, submit }) =>
    guard(async () => {
      const { cdp, sessionId } = await session();
      await cdp.send("Input.insertText", { text }, sessionId);
      if (submit)
        for (const type of ["keyDown", "keyUp"])
          await cdp.send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: type === "keyDown" ? "\r" : undefined }, sessionId);
      await new Promise((r) => setTimeout(r, 1000));
      return snapshot(`typed ${JSON.stringify(text)}${submit ? " and pressed Enter" : ""}`);
    }),
);

async function shutdown() {
  const s = await state?.catch(() => null);
  if (s) {
    s.cdp.close();
    await s.chrome.kill();
  }
  process.exit(0);
}
process.stdin.on("close", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
await server.connect(new StdioServerTransport());
