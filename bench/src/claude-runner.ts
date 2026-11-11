// Runs one benchmark task through headless Claude Code (`claude -p`), which
// authenticates with the user's Claude subscription. Context is stripped so the
// token count is mostly the browser tool's output: no built-in tools, a
// replacement system prompt, no user/project settings (so no hooks, plugins or
// CLAUDE.md from the user's setup), and only the tool's MCP server.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import readline from "node:readline";
import { parseRateLimit, QUOTA_ERROR, type RateLimit } from "./plan.ts";
import { MCP_SERVER_NAME } from "./tools.ts";

export interface RunSpec {
  prompt: string;
  systemPrompt: string;
  model: string;
  effort: string;
  mcpConfigPath: string;
  cwd: string;
  timeoutMs: number;
  maxBudgetUsd: number;
  transcriptPath: string;
  /** Extra environment for the claude process (inherited by the MCP server). */
  env?: Record<string, string>;
  /**
   * Load tool definitions on demand: the agent gets a ToolSearch tool and the
   * browser tools' definitions stay out of the prompt until it asks for them.
   */
  toolSearch?: boolean;
}

export interface RunOutcome {
  /** "quota": the subscription limit was hit; the run says nothing about the tool and should be retried. */
  // "launch_failed": the CLI died before producing anything (e.g. Windows 0xC0000142 when
  // memory is short); like "quota", the run says nothing about the tool and should be retried.
  status: "ok" | "error" | "timeout" | "quota" | "launch_failed";
  resultText: string;
  error?: string;
  wallSeconds: number;
  cliDurationMs?: number;
  numTurns?: number;
  costUsd?: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  toolCalls: number;
  toolCallsByName: Record<string, number>;
  toolResultChars: number;
  toolResultImages: number;
  models: string[];
  /** Latest subscription usage reported during the run. */
  rateLimit: RateLimit | null;
}

interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

type ContentBlock =
  | { type: "tool_use"; name: string }
  | { type: "tool_result"; content?: string | Array<{ type: string; text?: string }> }
  | { type: string };

interface StreamMessage {
  type: string;
  subtype?: string;
  message?: { content?: ContentBlock[] | string };
  result?: string;
  is_error?: boolean;
  duration_ms?: number;
  num_turns?: number;
  total_cost_usd?: number;
  modelUsage?: Record<string, ModelUsage>;
  rate_limit_info?: Parameters<typeof parseRateLimit>[0];
}

export function claudeArgs(spec: RunSpec): string[] {
  return [
    "-p",
    spec.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    spec.model,
    "--effort",
    spec.effort,
    "--system-prompt",
    spec.systemPrompt,
    "--tools",
    spec.toolSearch ? "ToolSearch" : "",
    "--mcp-config",
    spec.mcpConfigPath,
    "--strict-mcp-config",
    "--allowedTools",
    spec.toolSearch ? `mcp__${MCP_SERVER_NAME} ToolSearch` : `mcp__${MCP_SERVER_NAME}`,
    "--permission-mode",
    "dontAsk",
    "--setting-sources",
    "project",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--no-chrome",
    "--max-budget-usd",
    String(spec.maxBudgetUsd),
  ];
}

/** Kill a process and its children (the MCP server and its browser). */
function killTree(pid: number): void {
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
  else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      process.kill(pid, "SIGKILL");
    }
  }
}

export async function runClaude(spec: RunSpec): Promise<RunOutcome> {
  const started = performance.now();
  const out: RunOutcome = {
    status: "error",
    resultText: "",
    wallSeconds: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    toolCalls: 0,
    toolCallsByName: {},
    toolResultChars: 0,
    toolResultImages: 0,
    models: [],
    rateLimit: null,
  };
  const transcript = fs.createWriteStream(spec.transcriptPath);
  const child = spawn("claude", claudeArgs(spec), {
    cwd: spec.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    // By default every tool's definitions stay loaded so all tools are measured
    // alike; with toolSearch they load on demand through the ToolSearch tool.
    env: { ...process.env, ENABLE_TOOL_SEARCH: spec.toolSearch ? "true" : "false", ...spec.env },
    detached: process.platform !== "win32",
  });

  let stderr = "";
  child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    if (child.pid) killTree(child.pid);
  }, spec.timeoutMs);

  let sawResult = false;
  const lines = readline.createInterface({ input: child.stdout });
  for await (const line of lines) {
    if (!line.trim()) continue;
    transcript.write(line + "\n");
    let msg: StreamMessage;
    try {
      msg = JSON.parse(line) as StreamMessage;
    } catch {
      continue;
    }
    const content = Array.isArray(msg.message?.content) ? msg.message.content : [];
    if (msg.type === "rate_limit_event" && msg.rate_limit_info) {
      out.rateLimit = parseRateLimit(msg.rate_limit_info);
    } else if (msg.type === "assistant") {
      for (const b of content) {
        if (b.type === "tool_use" && "name" in b) {
          out.toolCalls++;
          out.toolCallsByName[b.name] = (out.toolCallsByName[b.name] ?? 0) + 1;
        }
      }
    } else if (msg.type === "user") {
      for (const b of content) {
        if (b.type !== "tool_result" || !("content" in b)) continue;
        if (typeof b.content === "string") out.toolResultChars += b.content.length;
        else for (const part of b.content ?? []) {
          if (part.type === "text") out.toolResultChars += part.text?.length ?? 0;
          else if (part.type === "image") out.toolResultImages++;
        }
      }
    } else if (msg.type === "result") {
      sawResult = true;
      out.resultText = msg.result ?? "";
      out.status = msg.is_error ? "error" : "ok";
      if (msg.is_error) out.error = `${msg.subtype ?? "error"}: ${(msg.result ?? "").slice(0, 300)}`;
      out.cliDurationMs = msg.duration_ms;
      out.numTurns = msg.num_turns;
      out.costUsd = msg.total_cost_usd;
      for (const [model, u] of Object.entries(msg.modelUsage ?? {})) {
        out.models.push(model);
        out.inputTokens += u.inputTokens ?? 0;
        out.outputTokens += u.outputTokens ?? 0;
        out.cacheReadTokens += u.cacheReadInputTokens ?? 0;
        out.cacheWriteTokens += u.cacheCreationInputTokens ?? 0;
      }
    }
  }

  const code: number | null = await new Promise((resolve) => {
    if (child.exitCode !== null) resolve(child.exitCode);
    else child.on("close", resolve);
  });
  clearTimeout(timer);
  transcript.end();
  out.wallSeconds = (performance.now() - started) / 1000;
  if (timedOut) {
    out.status = "timeout";
    out.error = `killed after ${spec.timeoutMs / 1000}s`;
  } else if (!sawResult) {
    out.status = "error";
    out.error = `exit ${code}, no result message. stderr: ${stderr.slice(0, 500)}`;
    const tokens = out.inputTokens + out.outputTokens + out.cacheReadTokens + out.cacheWriteTokens;
    if (tokens === 0 && out.toolCalls === 0) out.status = "launch_failed";
  }
  const limitHit = out.rateLimit?.status === "rejected" || QUOTA_ERROR.test(out.error ?? "");
  // A limit message can also arrive as a normal result with no ANSWER line.
  const limitText = out.status === "ok" && !/ANSWER:/.test(out.resultText) && QUOTA_ERROR.test(out.resultText);
  if ((out.status === "error" && limitHit) || limitText) out.status = "quota";
  return out;
}
