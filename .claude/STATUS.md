# Status (rewrite at every checkpoint; snapshot, not a log; under ~40 lines)

Updated: 2026-11-09

## Now
- Benchmark harness (`bench/`): 60 verified tasks on 20 sites; multi-tool runs, repeat-major and interleaved; usage guard (stops at 85% of the 5-hour window) and `--resume`. `npm test` 12/12, `npm run lint` clean.
- Baselines: Playwright MCP 0.0.84 and agent-browser 0.41.2. Smoke (Sonnet 5.5, 3 tasks x 1): both 3/3; Playwright ~27k median tokens, agent-browser ~74k (its 29 tool definitions are ~88k chars). About 0.33% of the 5-hour window per run on average.
- Full run started 2026-11-09 12:01: `results/2026-11-09T12-01-49-playwright-mcp+agent-browser` (360 runs, Sonnet 5.5, concurrency 3). It is expected to stop at the 85% guard partway through repeat 2; finish with `npm run bench -- --resume results/2026-11-09T12-01-49-playwright-mcp+agent-browser` after the window resets.
- Remote: github.com/govindplal/agentic-browser (private; public creation was blocked by the auto-mode classifier).
- No browser-layer code yet.

## Next
1. When the run stops: put the results table in README and docs/spec.md, set the non-headline targets, commit and push. Resume the remaining repeats in a later 5-hour window.
2. Start the engine: CDP driver + JSON capture + `open(url)` returning typed content in one call. Ask before installing `ws`/`devtools-protocol`.

## Open questions / blocked on the user
- Make the GitHub repo public? (They have to do it or allow it; the classifier blocks it.)
- Spec open questions: target users, map store home, decision model, project name.

## Learned this project (not yet in CLAUDE.md)
- (none)
