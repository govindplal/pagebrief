## Benchmark results

- `2026-11-11T16-30-38-playwright-mcp+agent-browser+plain-fetch+screenshot-browser+pagebrief`: playwright-mcp 0.0.84, model claude-sonnet-5-5, effort medium
- `2026-11-11T16-30-38-playwright-mcp+agent-browser+plain-fetch+screenshot-browser+pagebrief`: agent-browser 0.41.2, model claude-sonnet-5-5, effort medium
- `2026-11-11T16-30-38-playwright-mcp+agent-browser+plain-fetch+screenshot-browser+pagebrief`: plain-fetch 1.0.0, model claude-sonnet-5-5, effort medium
- `2026-11-11T16-30-38-playwright-mcp+agent-browser+plain-fetch+screenshot-browser+pagebrief`: screenshot-browser 1.0.0, model claude-sonnet-5-5, effort medium
- `2026-11-11T16-30-38-playwright-mcp+agent-browser+plain-fetch+screenshot-browser+pagebrief`: pagebrief 0.3.0, model claude-sonnet-5-5, effort medium

| Tool | Runs | Success | Median tokens/task | Mean tokens/task | Median s/task | Mean tool calls | Median cost/task | Est. API cost | Tokens vs baseline | Cost vs baseline |
|---|---|---|---|---|---|---|---|---|---|---|
| playwright-mcp | 60 | 100% | 26,144 | 28,420 | 10.3 | 2.8 | $0.0132 | $0.94 | baseline | baseline |
| agent-browser | 60 | 100% | 78,186 | 110,869 | 13.6 | 2.4 | $0.0332 | $2.74 | 3.0x more | 2.5x dearer |
| plain-fetch | 60 | 92% | 9,808 | 14,104 | 7.7 | 2.3 | $0.0196 | $1.72 | 2.7x fewer | 1.5x dearer |
| screenshot-browser | 60 | 98% | 9,105 | 12,059 | 13.2 | 2.4 | $0.0158 | $1.14 | 2.9x fewer | 1.2x dearer |
| pagebrief | 60 | 100% | 5,412 | 7,194 | 12.3 | 1.8 | $0.0120 | $0.81 | 4.8x fewer | 1.1x cheaper |

Tokens = input + cache reads + cache writes + output, summed over the whole task. Cost is the CLI's list-price estimate (runs used a subscription).

### By task kind

| Kind | playwright-mcp success | playwright-mcp median tokens | agent-browser success | agent-browser median tokens | plain-fetch success | plain-fetch median tokens | screenshot-browser success | screenshot-browser median tokens | pagebrief success | pagebrief median tokens |
|---|---|---|---|---|---|---|---|---|---|---|
| aggregate | 100% | 27,261 | 100% | 72,894 | 93% | 8,910 | 93% | 9,838 | 100% | 5,347 |
| interact | 100% | 60,623 | 100% | 183,385 | 67% | 14,093 | 100% | 4,789 | 100% | 7,367 |
| js-rendered | 100% | 17,290 | 100% | 70,392 | 100% | 7,560 | 100% | 4,795 | 100% | 4,370 |
| json-loaded | 100% | 26,525 | 100% | 180,260 | 86% | 5,035 | 100% | 14,848 | 100% | 9,187 |
| long-doc | 100% | 29,886 | 100% | 107,358 | 100% | 46,184 | 100% | 9,548 | 100% | 11,163 |
| lookup | 100% | 25,936 | 100% | 76,560 | 93% | 11,210 | 100% | 6,974 | 100% | 5,150 |
| navigate | 100% | 25,656 | 100% | 87,772 | 100% | 6,949 | 100% | 4,842 | 100% | 7,802 |
| search | 100% | 26,059 | 100% | 71,714 | 100% | 5,102 | 100% | 9,822 | 100% | 4,621 |

### Failed runs

| Tool | Task | Rep | Status | Answer / error |
|---|---|---|---|---|
| plain-fetch | hn-1 | 1 | ok | Show HN: Podcat – Imdb for podcasts — 401 points |
| plain-fetch | hn-3 | 1 | ok | Show HN: Podcat – Imdb for podcasts (rank 7) |
| plain-fetch | pk-2 | 1 | ok | 2022-02-18 |
| plain-fetch | tf-1 | 1 | ok | 219 inputs and 109 outputs |
| plain-fetch | docsrs-2 | 1 | ok | 27 |
| screenshot-browser | wb-1 | 1 | ok | 9 |
