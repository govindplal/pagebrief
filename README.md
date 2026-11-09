# agentic-browser

An open-source browser layer that opens any web page as a typed interface for AI agents: what is on the page, what the agent can do, and what changed after each action. It ships as an MCP server. The goal is the same task with far fewer tokens and seconds than today's browser tools, proven by the benchmark below rather than claimed. Spec: [docs/spec.md](docs/spec.md).

Status: the benchmark exists; the browser layer itself is not built yet.

## Benchmark

60 reading tasks on 20 public sites (3 per site), each with a verified answer key in [bench/tasks.json](bench/tasks.json). Sites are chosen so answers don't drift: scraping sandboxes with fixed data (books.toscrape.com, quotes.toscrape.com, scrapethissite.com, webscraper.io), versioned or immutable pages (crates.io, pkg.go.dev, rubygems, NuGet, Packagist, the Terraform registry, docs.rs, GitHub commits and releases, arXiv versions, a pinned Wikipedia revision, RFC 9110) and a Wayback Machine snapshot of a job board.

Each run gives a headless Claude Code agent (`claude -p`) one task, a start URL and only the browser tool under test, mounted as an MCP server. Claude Code's built-in tools, settings, hooks and plugins are turned off, so the measured tokens are mostly the tool's own. Tool search is off too, so every tool's full definitions are in context, as an MCP client without deferred loading would see them. The agent must browse; runs that answer without a browser call are marked `no_browse` and scored wrong.

Baselines, both on the same headless Google Chrome:
- [Playwright MCP](https://github.com/microsoft/playwright-mcp) 0.0.84, default settings
- [Vercel agent-browser](https://github.com/vercel-labs/agent-browser) 0.41.2, `agent-browser mcp` with its default `core` tool profile

Metrics per task: success against the answer key, total tokens (input + cache reads + cache writes + output), wall-clock seconds, tool calls, and Claude Code's list-price cost estimate.

```bash
npm install
npm run bench -- --tool playwright-mcp --tasks bts-1,hn-1 --repeats 1               # a quick check
npm run bench -- --tool playwright-mcp,agent-browser --concurrency 3                # all 60 tasks x 3, both tools
npm run bench -- --resume results/<runId>                                           # continue a stopped run
npm run bench:report -- results/<run-a> results/<run-b>                             # compare runs
```

Requires the Claude Code CLI, logged in, and Google Chrome. Runs spend the logged-in Claude subscription's quota, so the runner watches the usage Claude Code reports and stops at 85% of the 5-hour window (`--stop-at`; 90% of the weekly window with `--stop-at-weekly`). Runs go repeat by repeat with tools interleaved, so a stopped run is still a fair comparison, and `--resume` picks up where it stopped. All runs share one working directory so the prompt cache serves each tool's definitions across runs.

### Results

The full baseline has not been run yet. Smoke run, 2026-11-09, Playwright MCP 0.0.84, `claude-opus-5-5` at medium effort, 3 tasks x 1:

| Tool | Runs | Success | Median tokens/task | Median s/task | Mean tool calls |
|---|---|---|---|---|---|
| playwright-mcp | 3 | 100% | 18,679 | 10.9 | 3.3 |

Three tasks don't support conclusions. One observation already shapes the design: about 8k tokens per turn are the baseline's system prompt plus 25 tool definitions, so on simple lookups most tokens are fixed overhead rather than page content.
