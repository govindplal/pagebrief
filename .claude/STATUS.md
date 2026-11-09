# Status (rewrite at every checkpoint; snapshot, not a log; under ~40 lines)

Updated: 2026-11-09

## Now
- Benchmark harness (`bench/`): 60 verified tasks on 20 sites; multi-tool runs, repeat-major and interleaved; usage guard (stops at 85% of the 5-hour window), `--resume`, and launch failures are not recorded (stops after 3 in a row). `npm test` 12/12, lint clean.
- Baseline repeat 1 complete (Sonnet 5.5): Playwright MCP 95%, 26.4k median tokens, 14.3 s; agent-browser 95%, 77.5k, 17.1 s. Both fail only the 3 openlibrary.org tasks (site now serves a human-verification page). In README, docs/spec.md and docs/results/2026-11-09-baseline-rep1.md.
- Run dir `results/2026-11-09T12-01-49-playwright-mcp+agent-browser` (gitignored): 223 real runs (rep 1 complete, rep 2: 52 + 51). 137 records from failed launches were removed (backup `runs.with-launch-failures.jsonl.bak`). Claude Code killed the run for low system memory; 5-hour usage was at 60% then.
- Remote: github.com/govindplal/agentic-browser (private; public creation was blocked by the auto-mode classifier).
- No browser-layer code yet.

## Next
1. Finish repeats 2-3, only when the user asks (Claude Code said not to restart it unprompted): `npm run bench -- --resume results/2026-11-09T12-01-49-playwright-mcp+agent-browser --concurrency 2`. ~137 runs, ~45% of a 5-hour window.
2. Replace openlibrary.org with another stable site (3 verified tasks); rerun just those tasks for both tools.
3. Confirm the proposed non-headline targets (docs/spec.md), then start the engine: CDP driver + JSON capture + `open(url)` returning typed content in one call. Ask before installing `ws`/`devtools-protocol`.

## Open questions / blocked on the user
- Go-ahead to resume repeats 2-3 (and at what concurrency).
- Make the GitHub repo public?
- Spec open questions: target users, map store home, decision model, project name.

## Learned this project (not yet in CLAUDE.md)
- (none)
