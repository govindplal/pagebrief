# Status (rewrite at every checkpoint; snapshot, not a log; under ~40 lines)

Updated: 2026-11-09

## Now
- Engine v0.1 built: raw CDP (built-in WebSocket) on headless installed Chrome, JSON capture, `open` / `find` / `read`, MCP server, CLI; registered as `agentic-browser` in `bench/src/tools.ts`. `npm test` 20/20 (incl. end-to-end against real Chrome), typecheck clean.
- First smoke: bts-2 correct in 13,820 tokens (Playwright 34,192, agent-browser 69,768 on the same task), but 24.5 s vs 19.8 s. The other 2 smoke tasks didn't run: the usage guard stopped at 81% of the 5-hour window.
- Baseline repeat 1 complete (Sonnet 5.5): Playwright MCP 95%, 26.4k median tokens, 14.3 s; agent-browser 95%, 77.5k, 17.1 s. Openlibrary tasks fail for both (bot check). Baseline run dir `results/2026-11-09T12-01-49-playwright-mcp+agent-browser` has repeat 2 partial (52 + 51).
- README rewritten for outside readers (architecture decisions table); repo is private on GitHub.

## Engine benchmark (2026-11-09, repeat 1)
- agentic-browser v0.1: 98% success, 5,385 median tokens (4.9x fewer than Playwright MCP's 26,402), 12.1 s median, 2.0 mean calls. Run dir `results/2026-11-09T17-27-59-agentic-browser`; report `docs/results/2026-11-09-engine-v0.1-rep1.md`.

## Next
1. After the 5-hour window resets: run the engine on all 60 tasks x 1 (`npm run bench -- --tool agentic-browser --repeats 1 --concurrency 2`, ~60 runs) and compare with baseline repeat 1 via `npm run bench:report`.
2. Look at failures and seconds: the network-quiet wait (500 ms quiet, 5 s cap) may make open() slower than Playwright; tune the text budget (3,000 chars) and link handling.
3. Replace openlibrary.org with another stable site; finish baseline repeats 2-3 (`--resume`, concurrency 2).
4. Map cache per page type; typed fields from captured JSON.

## Open questions / blocked on the user
- Make the GitHub repo public (the user's call)?
- Confirm proposed non-headline targets in docs/spec.md (≤14.3 s median, ≤1.5 mean tool calls).
- Spec open questions: target users, map store home, decision model, project name.

## Learned this project (not yet in CLAUDE.md)
- (none)
