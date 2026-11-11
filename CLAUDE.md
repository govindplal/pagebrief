# pagebrief

MCP server that gives AI agents any web page as compact, typed text, driven over raw CDP, with page maps so repeat visits to a page type are answered from checked fields. Formerly `agentic-browser` (renamed 2026-11-11: that npm name belongs to another package). It must beat Playwright MCP on cost and seconds per task at equal or better accuracy, proven by the benchmark in `bench/`. Spec and review notes: `docs/spec.md`. Architecture decisions and their reasons: `README.md`.

## Architecture principles
- The agent only talks to our MCP server. Everything below it (CDP, Chrome, later Lightpanda) is swappable without touching the agent-facing surface.
- Drive Chrome over raw CDP. No Playwright or Puppeteer in the product; they are only benchmark baselines.
- Few, short tool definitions and few turns: definitions are re-sent every turn and dominate token cost.
- Build each page view from the best source, in order: WebMCP tools, JSON the page loaded, forms/labels/text, a model only as a last resort, always behind an interface.
- Page maps: a large model writes a map once per page type; plain code checks every field on every load; a failed check shows the text view, never a wrong value; a small model may repair. Never call the small model "trained" or "distilled" unless it was fine-tuned on the teacher's labels.
- Local first. Read-only, public pages only. Maps live in `~/.pagebrief/maps` and never leave the machine.
- The benchmark is the gate: nothing is "faster" or "cheaper" without a results table behind it. Lead with cost and seconds, not tokens.

## Layout
- `src/cdp/`: CDP client (built-in WebSocket) and Chrome launcher (`PAGEBRIEF_CHROME_ARGS` adds flags, e.g. `--no-sandbox` on Ubuntu CI)
- `src/browser.ts`: one tab; navigate, wait for network quiet, capture JSON, extract in one `Runtime.evaluate` (never `Runtime.enable`)
- `src/net/guard.ts`: refuses localhost and private-network URLs unless `allowPrivate` (`--allow-private`); behind a proxy the connected-address check is off and redirect hops are checked by name
- `src/page/`: in-page extraction (drops invisible text, reports bot-check signals), JSON ranking, and the pure view functions behind `open` / `find` / `read` (bot checks and login walls are reported, not returned)
- `src/maps/`: page maps: types (zod), URL patterns, the checker (`apply.ts`), file store, teacher and student behind an `Llm` interface (Claude via `claude -p`, or Ollama)
- `src/engine.ts`, `src/mcp.ts`, `src/cli.ts`: operations (opens queued, last 5 pages kept, maps applied), MCP server, CLI (`mcp`, `open`, `teach`, `maps`); `bin/pagebrief.js` is the npx entry point
- `bench/`: tasks with answer key (`tasks.json`, `tasks-repeat.json` for the repeat-visit track), runner (headless Claude Code), scorer, report, teacher run (`teach.ts`, maps in `bench/maps/`), map evaluation (`map-eval.ts`), grader (`grade.ts`), evaluation report (`eval-report.ts`); `bench/scripts/` builds the repeat-track answer key and measures the invisible-text drop

## Stack
- TypeScript, Node 22+ (developed on 25), ESM, run from source with `tsx`; `zod` schemas; `node:test` (not vitest: vitest 5.1.0's peer dependencies break `npm install`)
- `@modelcontextprotocol/sdk` for the server; no other runtime dependencies
- Models for maps: Claude through the Claude Code CLI on the user's subscription (no API key; teacher `claude-opus-5-5` in the benchmark, student `claude-haiku-5-5`), or a local model through Ollama (`ollama:<model>`; Ollama is not installed on the dev machine)
- Benchmark agent: headless Claude Code (`claude -p`), `claude-sonnet-5-5`, effort `medium`
- Baselines: `@playwright/mcp` 0.0.84 and `agent-browser` 0.41.2 (`agent-browser mcp`, core profile), all on headless installed Chrome; `plain-fetch` (no browser, one tool)
- CI: GitHub Actions on Ubuntu and Windows (lint, tests, and a clean install from the packed tarball)

## Commands
- Test: `npm test` (includes end-to-end tests against real Chrome)
- Typecheck: `npm run lint`
- Try a page: `npm run open -- <url> [--find <regex>] [--allow-private] [--maps off]`
- Teach a map: `npx tsx src/cli.ts teach <url> [--teacher <model>] [--maps <dir>]`
- Benchmark: `npm run bench -- --tool pagebrief,playwright-mcp [--tasks id1,id2] [--repeats 3] [--concurrency 2] [--tool-search] [--tasks-file bench/tasks-repeat.json]`
- Continue a stopped run: `npm run bench -- --resume results/<runId> [--repeats 3]`
- Compare runs: `npm run bench:report -- results/<run-a> results/<run-b>`
- Maps: `npm run bench:teach` (writes `bench/maps/`), `npm run bench:maps` (map quality and simulated breakage, no agent), `npm run bench:grade -- results/<runId>`, `npm run bench:eval -- --run results/<runId> --map-eval <file>`

## Benchmark notes
- Runs spend the user's subscription quota: ask before any run beyond a few tasks. The runner reads Claude Code's `rate_limit_event` and stops dispatching at `--stop-at` / `--stop-at-weekly`; limit-hit and failed-launch runs are not recorded, so `--resume` reruns them.
- Context is stripped with the flag set in `bench/src/claude-runner.ts` (`--bare` would be simpler but rejects subscription auth). Fixed overhead: 761 tokens.
- Every tool is mounted as MCP server `browser` (tool names `mcp__browser__*`). The first tool in `--tool` is the report's baseline column.
- All runs share one empty agent cwd so the prompt cache serves tool definitions across runs. By default `ENABLE_TOOL_SEARCH=false` keeps every tool's definitions loaded; `--tool-search` passes `--tools ToolSearch` and `ENABLE_TOOL_SEARCH=true` so definitions load on demand.
- `pagebrief` runs with maps off (a first visit); `pagebrief-mapped` copies `bench/maps` into each run's scratch dir (a repeat visit). Its version includes a hash of the maps, so `--resume` refuses changed maps.
- agent-browser keeps a browser daemon per session; each run gets its own `AGENT_BROWSER_SESSION`, closed after the run.
- Use `--concurrency 2` on a 16 GB machine; at 3, Windows ran out of memory after ~220 runs (`claude` exiting 0xC0000142).
- Answer key: verify against page HTML or the site's API, never from memory; parse with regex/JSON.parse, never `eval`. Pages render dates in local time, so date checks allow ±1 day.
- Live retail and job sites block plain HTTP. openlibrary.org, pypi.org and metacpan.org serve bot checks to headless browsers (openlibrary was replaced by hex.pm in tasks v2).

## Workflow
- Plan before non-trivial edits; run tests and typecheck and report real results before calling work done.
- Commit and push to `origin` (github.com/govindplal/pagebrief) at every checkpoint.
- In this shell, heredocs collapse `\\` to `\`: write files with backslashes through the Write/Edit tools, not `cat <<EOF` or inline Python.

## Current status
@.claude/STATUS.md
