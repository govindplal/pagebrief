// MCP server over stdio. Three read-only tools with short descriptions: tool
// definitions are re-sent on every agent turn, so each word here costs tokens
// on every step of every task. A fourth tool, do, exists only when the server
// is started with --allow-actions.
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
  const server = new McpServer({ name: "pagebrief", version: VERSION });
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
  const page = z.string().optional().describe("page id from open, e.g. p2; default: the last opened");
  server.registerTool(
    "find",
    {
      description: "Search the open page: all visible text lines, links (with URLs), and loaded JSON. Case-insensitive regex.",
      inputSchema: { pattern: z.string(), page },
      annotations: readOnly,
    },
    ({ pattern, page }) => run(() => engine.find(pattern, page)),
  );
  server.registerTool(
    "read",
    {
      description: "Read more of the open page's text from a character offset.",
      inputSchema: { from: z.number().int().min(0), length: z.number().int().min(200).max(20000).optional(), page },
      annotations: readOnly,
    },
    ({ from, length, page }) => run(() => engine.read(from, length, page)),
  );

  if (engine.actionPolicy) {
    server.registerTool(
      "do",
      {
        description:
          "Act on the open page using an action id from open or do (e.g. a3): follow a link, press a button, type into a field (value; submit sends its form) or choose an option. Returns what changed. Each action is labelled read, write or dangerous; the server refuses what its policy does not allow.",
        inputSchema: {
          id: z.string().describe("action id, e.g. a3"),
          value: z.string().optional().describe("text to type, or the option to choose"),
          submit: z.boolean().optional().describe("submit the field's form after filling it"),
          page,
        },
        annotations: { readOnlyHint: false, destructiveHint: engine.actionPolicy === "dangerous", idempotentHint: false, openWorldHint: true },
      },
      ({ id, value, submit, page }) => run(() => engine.act(id, value, submit, page)),
    );
  }

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
