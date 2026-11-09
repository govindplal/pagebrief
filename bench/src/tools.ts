// Browser tools under test. Every tool is mounted as an MCP server named
// "browser", so the agent sees the same tool prefix (mcp__browser__*) and the
// only variable between runs is the tool itself.
import fs from "node:fs";
import path from "node:path";

export const MCP_SERVER_NAME = "browser";

export interface McpServer {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface ToolUnderTest {
  id: string;
  description: string;
  /** Version recorded in run metadata, read from what is installed. */
  version: () => string;
  /** Server config for one run; workDir is a scratch dir the tool may write into. */
  server: (workDir: string) => McpServer;
}

const packageVersion = (pkg: string): string =>
  (JSON.parse(fs.readFileSync(path.resolve("node_modules", pkg, "package.json"), "utf8")) as { version: string }).version;

export const TOOLS: Record<string, ToolUnderTest> = {
  "playwright-mcp": {
    id: "playwright-mcp",
    description: "Playwright MCP with default settings (accessibility snapshots), headless installed Chrome",
    version: () => packageVersion("@playwright/mcp"),
    server: (workDir) => ({
      command: process.execPath,
      args: [
        path.resolve("node_modules/@playwright/mcp/cli.js"),
        "--headless",
        "--isolated",
        "--browser",
        "chrome",
        "--output-dir",
        path.join(workDir, "pw-output"),
      ],
    }),
  },
};

export function getTool(id: string): ToolUnderTest {
  const tool = TOOLS[id];
  if (!tool) throw new Error(`unknown tool "${id}"; known: ${Object.keys(TOOLS).join(", ")}`);
  return tool;
}
