# Baseline, repeat 1 (2026-11-09)

Repeat 1 of run `2026-11-09T12-01-49-playwright-mcp+agent-browser`: all 60 tasks once per tool, Claude Code 2.1.319, `claude-sonnet-5-5`, effort medium, concurrency 3, Windows 11, headless Chrome. Repeats 2-3 are pending (the run was stopped by low system memory and will be resumed). The openlibrary.org tasks fail for both tools because the site now serves a human-verification page to headless browsers.


| Tool | Runs | Success | Median tokens/task | Mean tokens/task | Median s/task | Mean tool calls | Est. API cost | Tokens vs baseline |
|---|---|---|---|---|---|---|---|---|
| playwright-mcp | 60 | 95% | 26,402 | 29,550 | 14.3 | 3.0 | $0.97 | baseline |
| agent-browser | 60 | 95% | 77,514 | 108,991 | 17.1 | 2.3 | $2.11 | 2.9x more |

Tokens = input + cache reads + cache writes + output, summed over the whole task. Cost is the CLI's list-price estimate (runs used a subscription).

### By task kind

| Kind | playwright-mcp success | playwright-mcp median tokens | agent-browser success | agent-browser median tokens |
|---|---|---|---|---|
| aggregate | 100% | 26,590 | 100% | 73,729 |
| interact | 100% | 41,863 | 100% | 180,292 |
| js-rendered | 100% | 26,436 | 100% | 70,265 |
| json-loaded | 100% | 40,551 | 100% | 152,466 |
| long-doc | 100% | 22,654 | 100% | 106,983 |
| lookup | 90% | 26,200 | 90% | 74,207 |
| navigate | 100% | 30,774 | 100% | 87,595 |
| search | 100% | 31,019 | 100% | 113,411 |

### Failed runs

| Tool | Task | Rep | Status | Answer / error |
|---|---|---|---|---|
| playwright-mcp | ol-1 | 1 | ok | NOT_FOUND |
| agent-browser | ol-2 | 1 | ok | NOT_FOUND |
| playwright-mcp | ol-2 | 1 | ok | NOT_FOUND |
| agent-browser | ol-1 | 1 | ok | NOT_FOUND |
| playwright-mcp | ol-3 | 1 | ok | NOT_FOUND |
| agent-browser | ol-3 | 1 | ok | NOT_FOUND |

