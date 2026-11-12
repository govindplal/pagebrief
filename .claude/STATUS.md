# Status (rewrite at every checkpoint; snapshot, not a log; under ~40 lines)

Updated: 2026-11-12

## Now
- pagebrief v0.3.0 on master (`31576be`, pushed): engine, page maps (teacher / checker / student / grader), actions with risk labels and diffs, `--cdp-url`, map sharing, bot-check and login-wall reports, invisible-text drop. Lint clean; 70 tests at last full run (`5b17055`).
- Benchmark campaign finished 2026-11-12 (840 runs, Sonnet 5.5, one repeat). Reports in `docs/results/2026-11-11-*`.
- README rewritten with all three tracks. Walkthrough: `docs/walkthrough-new.html`. Interview explainer: `docs/explainer.html`.

## Measured (2026-11-11/12, one repeat)
- Main (60 tasks): Playwright MCP 100%, $0.0132, 10.3 s, 26,144 tok. pagebrief 100%, $0.0120, 12.3 s, 5,412 tok (4.8x fewer tokens, 1.1x cheaper, ~2 s slower). plain-fetch 92%, 7.7 s. agent-browser 100%, $0.0332.
- Tool search on: pagebrief $0.0139 / 27.0 s vs Playwright MCP $0.0229 / 28.6 s (1.6x cheaper).
- Repeat visits: mapped $0.0032 vs Playwright MCP $0.0113 (3.5x cheaper), 8.4 s vs 8.5 s.
- Map check: 59/60 task pages hit; `rv-hn-2` misses `title`.

## Next
1. Seconds: pagebrief is slower than Playwright MCP on the main track (the spec target says it must not be). Profile settle wait and extraction.
2. Plain-fetch scorer: some `NOT_FOUND` answers on HN tasks scored ok; check `bench/src/check.ts`.
3. Investigate `rv-hn-2` missing `title`.
4. Decide walkthrough file (`walkthrough-new.html` vs old `walkthrough.html`).
5. Three repeats of the main track (~720 runs) only with the user's go-ahead.

## Open questions / blocked on the user
- Make the repo public, set topics; npm publish needs the user's login (`npm whoami` is ENEEDAUTH).
- Fine-tuning (needs a GPU and more pages) and a real Lightpanda test: not started.

## Learned this project (not yet in CLAUDE.md)
- Tokens are not cost: re-sent tool definitions are prompt-cache reads, so 4.8x fewer tokens gave only 1.1x lower cost.
- Behind a proxy Chrome reports the proxy's address as `remoteIPAddress`; the connected-address check must be off there.
