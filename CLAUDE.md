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
Built: benchmark harness (`bench/`): 60 tasks on 20 sites with a verified answer key, a runner that drives headless Claude Code against any MCP browser tool, scorer, report. Smoke-tested against Playwright MCP (3/3).
Still to build:
- Full Playwright MCP baseline run (60 tasks x 3), results into README
- CDP driver for Chromium (needs approval for `ws` + `devtools-protocol`)
- Page view: typed content (JSON capture first, then accessibility tree), action list, diffs
- Local map cache per page type, checked on every load
- MCP server (needs `@modelcontextprotocol/sdk`, already approved) and a small CLI; register it in `bench/src/tools.ts` and benchmark it

## Stack (decided)
- TypeScript, Node 25, ESM, run with `tsx`; `zod` for schemas; `node:test` for tests (vitest 5.1.0 crashes npm's installer, see Gotchas)
- Benchmark agent: headless Claude Code (`claude -p`), using the user's Claude subscription (no API key). Model `claude-opus-5-5`, effort `medium`
- Baseline: `@playwright/mcp` pinned at 0.0.84, headless installed Chrome

## Commands
- Test: `npm test`
- Lint: `npm run lint` (typecheck, `tsc --noEmit`)
- Benchmark: `npm run bench -- --tool playwright-mcp [--tasks id1,id2] [--sites a.com] [--repeats 3] [--concurrency 3]`
- Compare runs: `npm run bench:report -- results/<baseline> results/<ours>`

## Gotchas
- Benchmark runs must not pick up the user's hooks, plugins or CLAUDE.md. `claude --bare` would do that but rejects subscription OAuth; use the flag set in `bench/src/claude-runner.ts` (empty temp cwd, `--setting-sources project`, `--tools ""`, `--system-prompt`, `--strict-mcp-config`). Baseline overhead measured at 761 tokens.
- Every tool under test is mounted as MCP server `browser`, so tool names are `mcp__browser__*` for all tools.
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
- **Ship every checkpoint:** after each completed feature (tests/lint green), commit. No remote yet: ask before adding one, then push to `origin` at each checkpoint.

## Current status
@.claude/STATUS.md
