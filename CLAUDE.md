# agentic-browser

An open-source browser layer that opens any web page as a typed interface for AI agents: content as typed data, actions as typed functions, and diffs after each action, served over MCP. Users are developers whose agents read the same kinds of pages repeatedly (price tracking, job listings, portal automation). The main constraint: it must beat Playwright MCP on tokens and seconds per task at equal or better accuracy, proven by the benchmark in `bench/`, before any write actions or shared map store get built. Spec and review notes: `docs/spec.md`.

## Architecture (non-negotiable principles)
- The agent only talks to our MCP server. Everything below it (CDP, Chromium, later Lightpanda) is swappable without touching the agent-facing surface.
- Product drives Chromium over raw CDP. No Playwright in the product; Playwright MCP is only the benchmark baseline.
- Return diffs, not whole pages, after every action.
- Build each page view from the best source, in order: WebMCP tools, JSON the page already loaded, forms/labels/accessibility tree, a model only as last resort.
- Plain code does most of the work. Any model call sits behind an interface; no large model on the agent's path.
- Few tool definitions and few turns: in the benchmark, the baseline's 25 tool definitions re-sent every turn are most of its token cost.
- Local first. Version 1 is read-only, public pages only. Maps of logged-in pages never leave the machine.
- The benchmark is the gate: nothing is "faster" or "cheaper" without a results table behind it.

## Built vs still to build
Built: benchmark harness (`bench/`): 60 tasks on 20 sites with a verified answer key, a runner that drives headless Claude Code against several MCP browser tools in one run (resumable, stops near the subscription's usage limit), scorer, report. Baselines: Playwright MCP and Vercel agent-browser.
Still to build:
- Finish the full two-baseline run (60 tasks x 3 x 2 tools), results into README
- CDP driver for Chromium (needs approval for `ws` + `devtools-protocol`)
- Page view: typed content (JSON capture first, then accessibility tree), action list, diffs
- Local map cache per page type, checked on every load
- MCP server (needs `@modelcontextprotocol/sdk`, already approved) and a small CLI; register it in `bench/src/tools.ts` and benchmark it

## Stack (decided)
- TypeScript, Node 25, ESM, run with `tsx`; `zod` for schemas; `node:test` for tests (vitest 5.1.0 crashes npm's installer, see Gotchas)
- Benchmark agent: headless Claude Code (`claude -p`), using the user's Claude subscription (no API key). Model `claude-sonnet-5-5` (the user's choice, to save quota), effort `medium`
- Baselines: `@playwright/mcp` pinned at 0.0.84 and `agent-browser` pinned at 0.41.2 (`agent-browser mcp`, core profile), both on headless installed Chrome

## Commands
- Test: `npm test`
- Lint: `npm run lint` (typecheck, `tsc --noEmit`)
- Benchmark: `npm run bench -- --tool playwright-mcp,agent-browser [--tasks id1,id2] [--sites a.com] [--repeats 3] [--concurrency 3] [--stop-at 0.85]`
- Continue a stopped run: `npm run bench -- --resume results/<runId> [--repeats 3]`
- Compare runs: `npm run bench:report -- results/<baseline> results/<ours>`

## Gotchas
- Benchmark runs must not pick up the user's hooks, plugins or CLAUDE.md. `claude --bare` would do that but rejects subscription OAuth; use the flag set in `bench/src/claude-runner.ts` (empty temp cwd, `--setting-sources project`, `--tools ""`, `--system-prompt`, `--strict-mcp-config`). Baseline overhead measured at 761 tokens.
- Every tool under test is mounted as MCP server `browser`, so tool names are `mcp__browser__*` for all tools.
- The runner reads Claude Code's `rate_limit_event` (5-hour and 7-day utilization) and stops dispatching at `--stop-at`; limit-hit runs aren't recorded, so `--resume` reruns them. Jobs are repeat-major and interleave tools, so a partial run is still balanced.
- All runs share one empty agent cwd: the CLI puts cwd in the system prompt, and a fixed one lets the prompt cache serve the tool definitions across runs (big quota saving). `ENABLE_TOOL_SEARCH=false` keeps large tool sets (agent-browser's ~88k chars of definitions) loaded instead of deferred behind a ToolSearch tool we don't provide.
- agent-browser keeps a browser daemon per session after its MCP server exits: each run gets its own `AGENT_BROWSER_SESSION` and the runner calls `agent-browser --session <s> close` afterwards. Its MCP tool names are `agent_browser_*` (`mcp call open` fails; use `agent_browser_open`).
- Creating a public GitHub repo is blocked by the auto-mode classifier; the repo was created private.
- Answer key: verify against page HTML or the site's API, never from memory. Parse downloaded data with regex/JSON.parse only; never `eval` it (auto mode blocks this, and rightly).
- webscraper.io cards put the price before the title; parse whole cards, not title-then-price.
- Live retail and job sites block plain HTTP (npm, Stack Overflow, eBay, Etsy, Indeed, Zillow, Yelp...). PyPI and MusicBrainz serve JS challenges. Tasks use sandboxes, versioned/immutable pages and Wayback snapshots instead.
- Pages render dates in local time; date checks allow +-1 day.
- npm `Cannot read properties of null (reading 'edgesOut')`: caused by vitest 5.1.0's peer deps. Don't add vitest.
- `.env.example` is unreadable to Claude (the template's `Read(./.env.*)` deny rule matches it); `rm -rf` is denied by project settings.

## Workflow
- Explore and plan before non-trivial edits; use `/start-feature` and `/fix-bug`, and `/wrap-up` to end a session.
- Run tests/lint and report real results before calling work done.
- Benchmark runs use the user's subscription quota: ask before any run beyond a few tasks.
- **Ship every checkpoint:** after each completed feature (tests/lint green), commit and push to `origin` (github.com/govindplal/agentic-browser, private).

## Current status
@.claude/STATUS.md
