// MCP server over stdio. Three read-only tools with short descriptions: tool
// definitions are re-sent on every agent turn, so each word here costs tokens
// on every step of every task.
import fs from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";
import { Engine } from "./engine.ts";

const VERSION = (JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

async function run(fn: () => string | Promise<string>): Promise<ToolResult> {
  try {
    return { content: [{ type: "text", text: await fn() }] };
  } catch (err) {
    return { content: [{ type: "text", text: `error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
  }
}

export async function serveMcp(engine = new Engine()): Promise<void> {
  const server = new McpServer({ name: "agentic-browser", version: VERSION });
  const readOnly = { readOnlyHint: true, openWorldHint: true };

  server.registerTool(
    "open",
    {
      description: "Open a URL. Returns the page as compact text: title, structured data, JSON the page loaded, forms, and the start of the visible text.",
      inputSchema: { url: z.string().describe("absolute http(s) URL") },
      annotations: readOnly,
    },
    ({ url }) => run(() => engine.open(url)),
  );
  server.registerTool(
    "find",
    {
      description: "Search the open page: all visible text lines, links (with URLs), and loaded JSON. Case-insensitive regex.",
      inputSchema: { pattern: z.string() },
      annotations: readOnly,
    },
    ({ pattern }) => run(() => engine.find(pattern)),
  );
  server.registerTool(
    "read",
    {
      description: "Read more of the open page's text from a character offset.",
      inputSchema: { from: z.number().int().min(0), length: z.number().int().min(200).max(20000).optional() },
      annotations: readOnly,
    },
    ({ from, length }) => run(() => engine.read(from, length)),
  );

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await engine.close();
    process.exit(0);
  };
  process.stdin.on("close", shutdown);
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await server.connect(new StdioServerTransport());
}
