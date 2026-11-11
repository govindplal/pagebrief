// Finds and launches the installed Google Chrome with a DevTools port.
// No bundled browser and no Playwright: the engine below the MCP surface is
// plain Chrome over CDP, so it can later be swapped (e.g. for Lightpanda).
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function findChrome(): string {
  const candidates = [
    process.env.AGENTIC_BROWSER_CHROME,
    process.env.CHROME_PATH,
    ...(process.platform === "win32"
      ? [
          path.join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
          path.join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
          path.join(process.env.LOCALAPPDATA ?? "", "Google\\Chrome\\Application\\chrome.exe"),
        ]
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/opt/google/chrome/chrome", "/usr/bin/chromium"]),
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error("Google Chrome not found; set AGENTIC_BROWSER_CHROME to its path");
  return found;
}

export interface Chrome {
  wsEndpoint: string;
  process: ChildProcess;
  kill(): Promise<void>;
}

export interface LaunchOptions {
  executablePath?: string;
  headless?: boolean;
  timeoutMs?: number;
  /** Extra Chrome command-line flags. */
  extraArgs?: string[];
}

export async function launchChrome(opts: LaunchOptions = {}): Promise<Chrome> {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentic-browser-"));
  const args = [
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-sync",
    "--disable-background-networking",
    "--mute-audio",
    ...(opts.headless === false ? [] : ["--headless=new"]),
    ...(opts.extraArgs ?? []),
    "about:blank",
  ];
  const proc = spawn(opts.executablePath ?? findChrome(), args, { stdio: ["ignore", "ignore", "pipe"] });
  const timeoutMs = opts.timeoutMs ?? 20_000;

  // Chrome prints "DevTools listening on ws://..." to stderr and also writes
  // DevToolsActivePort into the profile dir; take whichever appears first.
  const wsEndpoint = await new Promise<string>((resolve, reject) => {
    let stderr = "";
    const portFile = path.join(userDataDir, "DevToolsActivePort");
    const done = (err: Error | null, ws?: string) => {
      clearTimeout(timer);
      clearInterval(poll);
      proc.off("exit", onExit);
      if (err) {
        proc.kill();
        reject(err);
      } else resolve(ws!);
    };
    const onExit = (code: number | null) => done(new Error(`Chrome exited (${code}) before DevTools was ready. ${stderr.slice(-400)}`));
    const timer = setTimeout(() => done(new Error(`Chrome did not expose DevTools within ${timeoutMs} ms`)), timeoutMs);
    const poll = setInterval(() => {
      try {
        const [port, wsPath] = fs.readFileSync(portFile, "utf8").split("\n");
        if (port && wsPath) done(null, `ws://127.0.0.1:${port.trim()}${wsPath.trim()}`);
      } catch {
        // not written yet
      }
    }, 100);
    proc.stderr!.on("data", (d: Buffer) => {
      stderr += d.toString();
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(stderr);
      if (m) done(null, m[1]!);
    });
    proc.once("exit", onExit);
    proc.once("error", (e) => done(e));
  });

  return {
    wsEndpoint,
    process: proc,
    async kill() {
      if (proc.exitCode === null && proc.signalCode === null) {
        const exited = new Promise((r) => proc.once("exit", r));
        proc.kill();
        await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
      }
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        // Windows can hold profile files briefly; the OS temp cleaner gets them
      }
    },
  };
}
