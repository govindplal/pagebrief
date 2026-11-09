# Status (rewrite at every checkpoint; snapshot, not a log; under ~40 lines)

Updated: 2026-11-09

## Now
- Benchmark harness built and smoke-tested: `bench/` (60 verified tasks, 20 sites; runner via headless `claude -p` on the user's subscription; scorer; report). `npm test` 8/8, `npm run lint` clean.
- Smoke run vs Playwright MCP 0.0.84: 3/3 correct, 18-40k tokens, 10-14 s per task. ~8k tokens/turn are its system prompt + 25 tool definitions (details in docs/spec.md, "First measurement").
- No browser-layer code yet.

## Next
1. Full Playwright MCP baseline: `npm run bench -- --tool playwright-mcp --concurrency 3` (180 runs, ~20-30 min, ~$20-50 list price / subscription quota). Waiting on the user's go-ahead. Then put the table in README and set the non-headline targets (spec says: after the first baseline).
2. Consider a second baseline (Vercel agent-browser or Stagehand), per review note 1 in docs/spec.md.
3. Start the engine: CDP driver + JSON capture + `open(url)` returning typed content in one call. Ask before installing `ws`/`devtools-protocol`.

## Open questions / blocked on the user
- Go-ahead for the full baseline run (uses subscription quota).
- Git remote for pushes (none yet).
- Spec open questions: target users, map store home, decision model, project name.

## Learned this project (not yet in CLAUDE.md)
- (none)
