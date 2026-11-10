# agentic-browser

MCP browser layer that gives AI agents any web page as compact, typed text, driven over raw CDP. It must beat Playwright MCP on tokens and seconds per task at equal or better accuracy, proven by the benchmark in `bench/`, before write actions or a shared map store are built. Spec and review notes: `docs/spec.md`. Architecture decisions and their reasons: `README.md`.

## Architecture principles
- The agent only talks to our MCP server. Everything below it (CDP, Chrome, later Lightpanda) is swappable without touching the agent-facing surface.
- Drive Chrome over raw CDP. No Playwright or Puppeteer in the product; they are only benchmark baselines.
- Few, short tool definitions and few turns: definitions are re-sent every turn and dominate token cost.
- Build each page view from the best source, in order: WebMCP tools, JSON the page loaded, forms/labels/text, a model only as a last resort, always behind an interface.
- Return diffs, not whole pages, after actions (once actions exist).
- Local first. v1 is read-only, public pages only. Maps of logged-in pages never leave the machine.
- The benchmark is the gate: nothing is "faster" or "cheaper" without a results table behind it.

## Layout
- `src/cdp/`: CDP client (built-in WebSocket) and Chrome launcher
- `src/browser.ts`: one tab; navigate, wait for network quiet, capture JSON, extract in one `Runtime.evaluate` (never `Runtime.enable`)
- `src/net/guard.ts`: refuses localhost and private-network URLs unless `allowPrivate` (`--allow-private`); behind a proxy the connected-address check is off and redirect hops are checked by name
- `src/page/`: in-page extraction script, JSON ranking, and the pure view functions behind `open` / `find` / `read`
- `src/engine.ts`, `src/mcp.ts`, `src/cli.ts`: operations (opens are queued: one tab), MCP server, CLI; `bin/agentic-browser.js` is the npx entry point
- `bench/`: tasks with answer key, runner (headless Claude Code), scorer, report; `bench/src/plain-fetch.ts` is the no-browser baseline

## Stack
- TypeScript, Node 22+ (developed on 25), ESM, run from source with `tsx`; `zod` schemas; `node:test` (not vitest: vitest 5.1.0's peer dependencies break `npm install`)
- `@modelcontextprotocol/sdk` for the server; no other runtime dependencies
- Benchmark agent: headless Claude Code (`claude -p`) on the user's Claude subscription (no API key), `claude-sonnet-5-5`, effort `medium`
- Baselines: `@playwright/mcp` 0.0.84 and `agent-browser` 0.41.2 (`agent-browser mcp`, core profile), all on headless installed Chrome; `plain-fetch` (no browser, one tool)
- End-to-end tests pass `--no-proxy-server` and `allowPrivate` (or host-resolver rules) because they use a local HTTP server

## Commands
- Test: `npm test` (includes an end-to-end test against real Chrome)
- Typecheck: `npm run lint`
- Try a page: `npm run open -- <url> [--find <regex>] [--allow-private]`
- Benchmark: `npm run bench -- --tool agentic-browser,playwright-mcp [--tasks id1,id2] [--sites a.com] [--repeats 3] [--concurrency 2] [--stop-at 0.85]`
- Continue a stopped run: `npm run bench -- --resume results/<runId> [--repeats 3]`
- Compare runs: `npm run bench:report -- results/<run-a> results/<run-b>`

## Benchmark notes
- Runs spend the user's subscription quota: ask before any run beyond a few tasks. The runner reads Claude Code's `rate_limit_event` and stops dispatching at `--stop-at`; limit-hit and failed-launch runs are not recorded, so `--resume` reruns them.
- Context is stripped with the flag set in `bench/src/claude-runner.ts` (`--bare` would be simpler but rejects subscription auth). Fixed overhead: 761 tokens.
- Every tool is mounted as MCP server `browser` (tool names `mcp__browser__*`). The first tool in `--tool` is the report's baseline column.
- All runs share one empty agent cwd so the prompt cache serves tool definitions across runs. `ENABLE_TOOL_SEARCH=false` keeps every tool's definitions loaded, so tools are measured alike.
- agent-browser keeps a browser daemon per session; each run gets its own `AGENT_BROWSER_SESSION`, closed after the run.
- Use `--concurrency 2` on a 16 GB machine; at 3, Windows ran out of memory after ~220 runs (`claude` exiting 0xC0000142).
- Answer key: verify against page HTML or the site's API, never from memory; parse with regex/JSON.parse, never `eval`. Pages render dates in local time, so date checks allow ±1 day.
- Live retail and job sites block plain HTTP, and openlibrary.org now serves a human-verification page to headless browsers (its 3 tasks need replacing).

## Workflow
- Plan before non-trivial edits; run tests and typecheck and report real results before calling work done.
- Commit and push to `origin` (github.com/govindplal/agentic-browser) at every checkpoint.

## Current status
@.claude/STATUS.md
