## Benchmark results

- `2026-11-11T16-08-58-playwright-mcp+plain-fetch+screenshot-browser+pagebrief+pagebrief-mapped-tasks-repeat`: playwright-mcp 0.0.84, model claude-sonnet-5-5, effort medium
- `2026-11-11T16-08-58-playwright-mcp+plain-fetch+screenshot-browser+pagebrief+pagebrief-mapped-tasks-repeat`: plain-fetch 1.0.0, model claude-sonnet-5-5, effort medium
- `2026-11-11T16-08-58-playwright-mcp+plain-fetch+screenshot-browser+pagebrief+pagebrief-mapped-tasks-repeat`: screenshot-browser 1.0.0, model claude-sonnet-5-5, effort medium
- `2026-11-11T16-08-58-playwright-mcp+plain-fetch+screenshot-browser+pagebrief+pagebrief-mapped-tasks-repeat`: pagebrief 0.3.0, model claude-sonnet-5-5, effort medium
- `2026-11-11T16-08-58-playwright-mcp+plain-fetch+screenshot-browser+pagebrief+pagebrief-mapped-tasks-repeat`: pagebrief-mapped 0.3.0+maps.d8216a52, model claude-sonnet-5-5, effort medium

| Tool | Runs | Success | Median tokens/task | Mean tokens/task | Median s/task | Mean tool calls | Median cost/task | Est. API cost | Tokens vs baseline | Cost vs baseline |
|---|---|---|---|---|---|---|---|---|---|---|
| playwright-mcp | 60 | 100% | 25,620 | 24,832 | 8.5 | 2.3 | $0.0113 | $0.78 | baseline | baseline |
| plain-fetch | 60 | 100% | 4,615 | 5,865 | 5.9 | 1.5 | $0.0096 | $0.74 | 5.6x fewer | 1.2x cheaper |
| screenshot-browser | 60 | 100% | 4,820 | 7,197 | 9.0 | 1.5 | $0.0098 | $0.77 | 5.3x fewer | 1.2x cheaper |
| pagebrief | 60 | 100% | 4,656 | 5,262 | 8.8 | 1.1 | $0.0089 | $0.57 | 5.5x fewer | 1.3x cheaper |
| pagebrief-mapped | 60 | 100% | 3,947 | 4,239 | 8.4 | 1.1 | $0.0032 | $0.21 | 6.5x fewer | 3.5x cheaper |

Tokens = input + cache reads + cache writes + output, summed over the whole task. Cost is the CLI's list-price estimate (runs used a subscription).

### By task kind

| Kind | playwright-mcp success | playwright-mcp median tokens | plain-fetch success | plain-fetch median tokens | screenshot-browser success | screenshot-browser median tokens | pagebrief success | pagebrief median tokens | pagebrief-mapped success | pagebrief-mapped median tokens |
|---|---|---|---|---|---|---|---|---|---|---|
| repeat | 100% | 25,620 | 100% | 4,615 | 100% | 4,820 | 100% | 4,656 | 100% | 3,947 |
