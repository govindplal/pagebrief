// Baseline: no browser at all. One tool that downloads a URL over plain HTTP
// and returns it as markdown-like text, paged by character offset. It follows
// the shape of the reference MCP fetch server (url, max_length, start_index).
//
// It answers the question a browser tool has to answer first: on reading
// tasks, is a browser worth its cost? It cannot run JavaScript, so pages that
// render or load their data in the browser should fail here.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

const decode = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k in ENTITIES) return ENTITIES[k]!;
    const code = k.startsWith("#x") ? parseInt(k.slice(2), 16) : k.startsWith("#") ? Number(k.slice(1)) : NaN;
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });

/** HTML to compact text: title, headings as #, links as [text](url), one block per line. */
export function htmlToText(html: string, baseUrl: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  const abs = (href: string): string => {
    try {
      return new URL(decode(href), baseUrl).href;
    } catch {
      return href;
    }
  };
  const body = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|head|template|title)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\b[^>]*?href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
      const text = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      return text ? `[${text}](${abs(href)})` : "";
    })
    .replace(/<h([1-6])\b[^>]*>/gi, (_m, n: string) => `\n${"#".repeat(Number(n))} `)
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article|\/table|\/ul|\/ol|\/dd|\/dt)\b[^>]*>/gi, "\n")
    .replace(/<\/(td|th)\b[^>]*>/gi, "\t")
    .replace(/<[^>]+>/g, "");
  const text = decode(body)
    .replace(/[ \t ]+/g, (m) => (m.includes("\t") ? "\t" : " "))
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return title ? `# ${decode(title)}\n\n${text}` : text;
}

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export async function fetchText(url: string, startIndex = 0, maxLength = 5000): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "text/html,application/json;q=0.9,*/*;q=0.8" }, redirect: "follow", signal: AbortSignal.timeout(30_000) });
  const raw = await res.text();
  const type = res.headers.get("content-type") ?? "";
  const text = /html/i.test(type) || /^\s*<(!doctype|html)/i.test(raw) ? htmlToText(raw, res.url || url) : raw;
  const slice = text.slice(startIndex, startIndex + maxLength);
  const end = startIndex + slice.length;
  const more = end < text.length ? `\n[truncated at ${end} of ${text.length} characters; call again with start_index=${end}]` : "";
  return `${res.status === 200 ? "" : `HTTP ${res.status}\n`}${slice}${more}`;
}

async function serve(): Promise<void> {
  const server = new McpServer({ name: "plain-fetch", version: "1.0.0" });
  server.registerTool(
    "fetch",
    {
      description: "Fetch a URL over HTTP and return its content as text (HTML is converted to markdown-like text). No JavaScript is run.",
      inputSchema: {
        url: z.string().describe("absolute http(s) URL"),
        max_length: z.number().int().min(1).max(100000).optional().describe("characters to return (default 5000)"),
        start_index: z.number().int().min(0).optional().describe("character offset to start from"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ url, max_length, start_index }) => {
      try {
        return { content: [{ type: "text" as const, text: await fetchText(url, start_index, max_length) }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await serve();
