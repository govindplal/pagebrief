// Runs a list of benchmark stages unattended, across 5-hour usage windows.
// Each stage is one `npm run bench` run. When the runner stops at the usage
// guard, this waits for the window to reset and resumes the same run; it ends
// early if the 7-day guard is hit (that one does not reset soon).
//   npx tsx bench/scripts/campaign.ts [--stop-at 0.85] [--stop-at-weekly 0.8] [--stages repeat,main,toolsearch]
// Progress is written to results/campaign.json; output to stdout.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { values: opts } = parseArgs({
  options: {
    "stop-at": { type: "string", default: "0.85" },
    "stop-at-weekly": { type: "string", default: "0.8" },
    stages: { type: "string", default: "repeat,main,toolsearch" },
    concurrency: { type: "string", default: "2" },
    repeats: { type: "string", default: "1" },
  },
});

interface Stage {
  name: string;
  args: string[];
}

const common = ["--concurrency", opts.concurrency!, "--repeats", opts.repeats!, "--stop-at", opts["stop-at"]!, "--stop-at-weekly", opts["stop-at-weekly"]!];
const STAGES: Record<string, Stage> = {
  // The repeat-visit track: first visit, repeat visit, and every baseline.
  repeat: {
    name: "repeat",
    args: ["--tool", "playwright-mcp,plain-fetch,screenshot-browser,pagebrief,pagebrief-mapped", "--tasks-file", "bench/tasks-repeat.json", ...common],
  },
  // The main 60 tasks on v0.3 with every tool definition loaded.
  main: { name: "main", args: ["--tool", "playwright-mcp,agent-browser,plain-fetch,screenshot-browser,pagebrief", ...common] },
  // The same tasks with definitions loaded on demand (ToolSearch).
  toolsearch: { name: "toolsearch", args: ["--tool", "playwright-mcp,agent-browser,plain-fetch,pagebrief", "--tool-search", ...common] },
};

const statePath = path.resolve("results", "campaign.json");
const state: Record<string, { dir?: string; done?: boolean }> = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : {};
const save = () => {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
};
const log = (s: string) => console.log(`[campaign ${new Date().toISOString()}] ${s}`);

interface Summary {
  dir: string;
  remaining: number;
  resetsAt: number | null;
  fiveHour: number | null;
  sevenDay: number | null;
  weekly: boolean;
  stopReason: string | null;
}

function runBench(args: string[]): Promise<Summary | null> {
  return new Promise((resolve) => {
    const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "bench", "--", ...args], { stdio: ["ignore", "pipe", "inherit"], shell: process.platform === "win32" });
    let summary: Summary | null = null;
    let buf = "";
    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) {
        if (l.startsWith("RUN_SUMMARY ")) summary = JSON.parse(l.slice("RUN_SUMMARY ".length)) as Summary;
        else if (/^\[\d+\/\d+\]|launch failed|quota|Stopped|results:/.test(l)) console.log(l);
      }
    });
    child.on("close", () => resolve(summary));
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  for (const name of opts.stages!.split(",")) {
    const stage = STAGES[name];
    if (!stage) throw new Error(`unknown stage ${name}`);
    const st = (state[name] ??= {});
    while (!st.done) {
      const args = st.dir ? ["--resume", st.dir, "--stop-at", opts["stop-at"]!, "--stop-at-weekly", opts["stop-at-weekly"]!, "--concurrency", opts.concurrency!] : stage.args;
      log(`stage ${name}: ${st.dir ? `resuming ${path.basename(st.dir)}` : "starting"}`);
      const s = await runBench(args);
      if (!s) throw new Error(`stage ${name}: the runner printed no summary (crashed?)`);
      st.dir = s.dir;
      save();
      if (s.remaining === 0) {
        st.done = true;
        save();
        log(`stage ${name} finished: ${s.dir}`);
        break;
      }
      log(`stage ${name} stopped with ${s.remaining} runs left: ${s.stopReason}`);
      if (s.weekly) {
        log("the 7-day guard stopped the run; ending the campaign (resume later with the same command)");
        return;
      }
      const wait = Math.max(60_000, ((s.resetsAt ?? Math.floor(Date.now() / 1000) + 600) + 120) * 1000 - Date.now());
      log(`waiting ${Math.round(wait / 60_000)} min for the 5-hour window to reset`);
      await sleep(wait);
    }
  }
  log("campaign finished");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
