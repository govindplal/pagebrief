// Browser tools under test. Every tool is mounted as an MCP server named
// "browser", so the agent sees the same tool prefix (mcp__browser__*) and the
// only variable between runs is the tool itself. All tools drive the same
// installed Google Chrome, headless.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { findChrome } from "../../src/cdp/chrome.ts";

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
  /** Server config for one run; workDir is a scratch dir unique to the run. */
  server: (workDir: string) => McpServer;
  /** Called after each run, e.g. to stop a browser daemon that outlives the MCP server. */
  cleanup?: (workDir: string) => void;
}

const packageVersion = (pkg: string): string =>
  (JSON.parse(fs.readFileSync(path.resolve("node_modules", pkg, "package.json"), "utf8")) as { version: string }).version;

const agentBrowserCli = (): string => path.resolve("node_modules/agent-browser/bin/agent-browser.js");
/** agent-browser session names allow letters, digits, hyphens and underscores. */
const agentBrowserSession = (workDir: string): string => `bench_${path.basename(workDir).replace(/[^A-Za-z0-9_-]/g, "_")}`;

export const TOOLS: Record<string, ToolUnderTest> = {
  "agentic-browser": {
    id: "agentic-browser",
    description: "This project: raw CDP on headless installed Chrome, 3 read-only tools (open, find, read)",
    version: () => (JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")) as { version: string }).version,
    server: () => ({
      command: process.execPath,
      args: ["--import", pathToFileURL(path.resolve("node_modules/tsx/dist/loader.mjs")).href, path.resolve("src/cli.ts"), "mcp"],
    }),
  },
  "plain-fetch": {
    id: "plain-fetch",
    description: "No browser: one tool that downloads the URL over HTTP and converts HTML to text (bench/src/plain-fetch.ts)",
    version: () => "1.0.0",
    server: () => ({
      command: process.execPath,
      args: ["--import", pathToFileURL(path.resolve("node_modules/tsx/dist/loader.mjs")).href, path.resolve("bench/src/plain-fetch.ts")],
    }),
  },
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
  "agent-browser": {
    id: "agent-browser",
    description: "Vercel agent-browser MCP server (`agent-browser mcp`, default core tool profile), headless installed Chrome",
    version: () => packageVersion("agent-browser"),
    server: (workDir) => ({
      command: process.execPath,
      args: [agentBrowserCli(), "mcp"],
      env: {
        AGENT_BROWSER_SESSION: agentBrowserSession(workDir),
        AGENT_BROWSER_EXECUTABLE_PATH: findChrome(),
        AGENT_BROWSER_SCREENSHOT_DIR: path.join(workDir, "ab-output"),
      },
    }),
    // The browser daemon outlives the MCP server; close this run's session.
    cleanup: (workDir) => {
      spawnSync(process.execPath, [agentBrowserCli(), "--session", agentBrowserSession(workDir), "close"], {
        stdio: "ignore",
        timeout: 30_000,
      });
    },
  },
};

export function getTool(id: string): ToolUnderTest {
  const tool = TOOLS[id];
  if (!tool) throw new Error(`unknown tool "${id}"; known: ${Object.keys(TOOLS).join(", ")}`);
  return tool;
}
