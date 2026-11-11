// Models behind one small interface, so the teacher and the student can be
// swapped: Claude through the Claude Code CLI (uses the user's subscription, no
// API key), or a local model through Ollama.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Usage } from "./types.ts";

export interface LlmReply {
  text: string;
  usage: Usage;
}

export interface Llm {
  readonly name: string;
  complete(system: string, prompt: string): Promise<LlmReply>;
}

/** The first JSON object in a reply (models sometimes wrap it in prose or a code fence). */
export function parseJsonReply(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("the model's reply has no JSON object");
  return JSON.parse(text.slice(start, end + 1));
}

interface CliResult {
  type?: string;
  is_error?: boolean;
  result?: string;
  total_cost_usd?: number;
  duration_ms?: number;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}

/** Claude via `claude -p`: one turn, no tools, no user settings. The prompt goes in on stdin (Windows caps command lines at 32k chars). */
export class ClaudeCli implements Llm {
  readonly name: string;
  constructor(
    readonly model = "claude-sonnet-5-5",
    private readonly opts: { timeoutMs?: number; maxBudgetUsd?: number } = {},
  ) {
    this.name = model;
  }

  complete(system: string, prompt: string): Promise<LlmReply> {
    const cwd = path.join(os.tmpdir(), "pagebrief-llm");
    fs.mkdirSync(cwd, { recursive: true });
    const args = [
      "-p",
      "--output-format",
      "json",
      "--model",
      this.model,
      "--system-prompt",
      system,
      "--tools",
      "",
      "--strict-mcp-config",
      "--setting-sources",
      "project",
      "--disable-slash-commands",
      "--no-session-persistence",
      "--no-chrome",
      "--max-budget-usd",
      String(this.opts.maxBudgetUsd ?? 1),
    ];
    const started = performance.now();
    return new Promise((resolve, reject) => {
      const child = spawn("claude", args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`claude did not answer within ${(this.opts.timeoutMs ?? 180_000) / 1000} s`));
      }, this.opts.timeoutMs ?? 180_000);
      child.stdout.on("data", (d: Buffer) => (out += d.toString()));
      child.stderr.on("data", (d: Buffer) => (err += d.toString()));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        let r: CliResult;
        try {
          r = JSON.parse(out) as CliResult;
        } catch {
          reject(new Error(`claude exited ${code}: ${(err || out).slice(0, 300)}`));
          return;
        }
        if (r.is_error || typeof r.result !== "string") {
          reject(new Error(`claude failed: ${(r.result ?? err).slice(0, 300)}`));
          return;
        }
        const u = r.usage ?? {};
        resolve({
          text: r.result,
          usage: {
            model: this.model,
            costUsd: r.total_cost_usd ?? null,
            tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
            seconds: Math.round((performance.now() - started) / 100) / 10,
          },
        });
      });
      child.stdin.end(prompt);
    });
  }
}

/** A local model served by Ollama (https://ollama.com), e.g. gemma3:4b. */
export class Ollama implements Llm {
  readonly name: string;
  constructor(
    readonly model = "gemma3:4b",
    private readonly baseUrl = process.env.OLLAMA_HOST ? `http://${process.env.OLLAMA_HOST.replace(/^https?:\/\//, "")}` : "http://127.0.0.1:11434",
    private readonly timeoutMs = 120_000,
  ) {
    this.name = `ollama:${model}`;
  }

  async complete(system: string, prompt: string): Promise<LlmReply> {
    const started = performance.now();
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        format: "json",
        options: { temperature: 0 },
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const r = (await res.json()) as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
    return {
      text: r.message?.content ?? "",
      usage: {
        model: this.name,
        costUsd: 0,
        tokens: (r.prompt_eval_count ?? 0) + (r.eval_count ?? 0),
        seconds: Math.round((performance.now() - started) / 100) / 10,
      },
    };
  }
}

/** "claude-haiku-5-5" -> Claude CLI; "ollama:gemma3:4b" -> Ollama. */
export function llmFromSpec(spec: string): Llm {
  return spec.startsWith("ollama:") ? new Ollama(spec.slice("ollama:".length)) : new ClaudeCli(spec);
}
