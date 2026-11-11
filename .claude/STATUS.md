# Status (rewrite at every checkpoint; snapshot, not a log; under ~40 lines)

Updated: 2026-11-10

## Now
- Engine v0.2 (branch `claude/engine-hardening-v0.2`, PR open): private-network guard (`src/net/guard.ts`, `--allow-private`), queued opens, main-content start, JSON ranking (`src/page/json-rank.ts`), event streams not waited for, cached and bounded `find`, `bin/agentic-browser.js`. `npm test` 41/41 (incl. end-to-end against real Chrome), typecheck clean.
- Benchmark additions: `plain-fetch` baseline (`bench/src/plain-fetch.ts`, one tool, no browser); report shows median cost per task and cost vs baseline.
- README rewritten: v0.2 changes, Safety section (the hidden-text claim was overstated), benchmark caveats, prior art.
- **v0.2 is not benchmarked.** Package version is 0.2.0, so `--resume` on a v0.1 run dir is refused; start a fresh run.

## Measured so far (2026-11-09, one repeat, Sonnet 5.5)
- Playwright MCP 95%, 26,402 median tokens, 14.3 s. agent-browser 95%, 77,514, 17.1 s.
- agentic-browser v0.1b: 95%, 5,346 median tokens (4.9x fewer than Playwright MCP), 12.7 s, 2.2 mean calls. (v0.1 before interaction fixes: 98%, 5,385, 12.1 s.)
- Openlibrary tasks fail for all tools (bot check).

## Next
1. Fresh run: `npm run bench -- --tool playwright-mcp,agent-browser,agentic-browser,plain-fetch --concurrency 2` (240 runs x repeats; ask before spending quota).
2. A run with tool search on (`ENABLE_TOOL_SEARCH` is forced to false in `bench/src/claude-runner.ts`; with `--tools ""` there is no ToolSearch tool, so this needs working out and verifying).
3. Replace openlibrary.org with another stable site.
4. Commit the per-run reports under `docs/results/` (the README no longer links to them because they were never committed).
5. Map cache per page type; typed fields from captured JSON.

## Open questions / blocked on the user
- Merge the v0.2 PR? Make the GitHub repo public and publish to npm (`private: true` is still set)?
- Confirm proposed non-headline targets in docs/spec.md (≤14.3 s median, ≤1.5 mean tool calls).
- Spec open questions: target users, map store home, decision model, project name.

## Learned this project (not yet in CLAUDE.md)
- Behind a proxy Chrome reports the proxy's address as `remoteIPAddress`, so the connected-address check must be off there; the redirect chain is checked by name instead. End-to-end tests pass `--no-proxy-server`.
