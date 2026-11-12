## Benchmark results

- `2026-11-11T21-14-54-playwright-mcp+agent-browser+plain-fetch+pagebrief-toolsearch`: playwright-mcp 0.0.84, model claude-sonnet-5-5, effort medium, tool search on
- `2026-11-11T21-14-54-playwright-mcp+agent-browser+plain-fetch+pagebrief-toolsearch`: agent-browser 0.41.2, model claude-sonnet-5-5, effort medium, tool search on
- `2026-11-11T21-14-54-playwright-mcp+agent-browser+plain-fetch+pagebrief-toolsearch`: plain-fetch 1.0.0, model claude-sonnet-5-5, effort medium, tool search on
- `2026-11-11T21-14-54-playwright-mcp+agent-browser+plain-fetch+pagebrief-toolsearch`: pagebrief 0.3.0, model claude-sonnet-5-5, effort medium, tool search on

| Tool | Runs | Success | Median tokens/task | Mean tokens/task | Median s/task | Mean tool calls | Median cost/task | Est. API cost | Tokens vs baseline | Cost vs baseline |
|---|---|---|---|---|---|---|---|---|---|---|
| playwright-mcp | 60 | 100% | 16,127 | 19,038 | 28.6 | 4.2 | $0.0229 | $1.79 | baseline | baseline |
| agent-browser | 60 | 100% | 23,130 | 32,160 | 23.4 | 4.3 | $0.0352 | $2.87 | 1.4x more | 1.5x dearer |
| plain-fetch | 60 | 93% | 12,560 | 16,202 | 17.1 | 3.0 | $0.0202 | $1.68 | 1.3x fewer | 1.1x cheaper |
| pagebrief | 60 | 100% | 8,472 | 10,580 | 27.0 | 2.6 | $0.0139 | $0.95 | 1.9x fewer | 1.6x cheaper |

Tokens = input + cache reads + cache writes + output, summed over the whole task. Cost is the CLI's list-price estimate (runs used a subscription).

### By task kind

| Kind | playwright-mcp success | playwright-mcp median tokens | agent-browser success | agent-browser median tokens | plain-fetch success | plain-fetch median tokens | pagebrief success | pagebrief median tokens |
|---|---|---|---|---|---|---|---|---|
| aggregate | 100% | 16,982 | 100% | 21,849 | 93% | 13,350 | 100% | 8,620 |
| interact | 100% | 15,414 | 100% | 58,978 | 100% | 13,323 | 100% | 9,173 |
| js-rendered | 100% | 13,196 | 100% | 32,345 | 100% | 11,787 | 100% | 7,569 |
| json-loaded | 100% | 23,353 | 100% | 44,183 | 100% | 8,402 | 100% | 14,777 |
| long-doc | 100% | 13,248 | 100% | 21,458 | 100% | 22,851 | 100% | 13,305 |
| lookup | 100% | 15,780 | 100% | 21,442 | 90% | 12,560 | 100% | 8,326 |
| navigate | 100% | 10,533 | 100% | 19,370 | 100% | 11,163 | 100% | 8,192 |
| search | 100% | 16,344 | 100% | 19,538 | 100% | 8,193 | 100% | 8,186 |

### Failed runs

| Tool | Task | Rep | Status | Answer / error |
|---|---|---|---|---|
| plain-fetch | hn-1 | 1 | ok | NOT_FOUND |
| plain-fetch | hn-2 | 1 | ok | NOT_FOUND |
| plain-fetch | hn-3 | 1 | ok | Show HN: Podcat – Imdb for podcasts (about rank 7, estimated from points) |
| plain-fetch | gh-2 | 1 | ok | April 6 (page shows "06 Apr 16:51", no year), by pavelfeldman |
