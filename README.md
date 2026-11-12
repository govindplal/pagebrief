<div align="center">

# pagebrief

**Any web page, as compact typed text for AI agents.**

An MCP server that drives Chrome over raw CDP and gives an agent a page in one call: rendered text, the JSON the page loaded, forms, and structured data. Repeat visits to a page type can be answered from **page maps**, fields a large model located once and plain code checks on every load.

![TypeScript](https://img.shields.io/badge/TypeScript-6-3178c6?logo=typescript&logoColor=white)
![Node](https://img.shields.io/badge/Node-%E2%89%A522-339933?logo=node.js&logoColor=white)
![MCP](https://img.shields.io/badge/protocol-MCP-6e56cf)
![Chrome DevTools Protocol](https://img.shields.io/badge/engine-raw%20CDP-4285f4?logo=googlechrome&logoColor=white)
![License](https://img.shields.io/badge/license-Apache--2.0-blue)
![Status](https://img.shields.io/badge/status-early%20%C2%B7%20v0.3-orange)

</div>

---

## Results first

Benchmark: 60 reading tasks on 20 public sites, headless Claude Code (`claude-sonnet-5-5`, effort medium), one repeat per task. Every tool scored 92% or better; the answer key is verified against page HTML or the site's API.

| Track | Tool | Success | Median cost/task | Median s/task | Median tokens |
|---|---|---|---|---|---|
| Main (60 tasks) | Playwright MCP | 100% | $0.0132 | **10.3** | 26,144 |
| | **pagebrief** | 100% | **$0.0120** | 12.3 | **5,412** |
| | agent-browser | 100% | $0.0332 | 13.6 | 78,186 |
| | plain-fetch | 92% | $0.0196 | 7.7 | 9,808 |
| | screenshot-browser | 98% | $0.0158 | 13.2 | 9,105 |
| Tool search on (60 tasks) | Playwright MCP | 100% | $0.0229 | 28.6 | 16,127 |
| | **pagebrief** | 100% | **$0.0139** | 27.0 | **8,472** |
| | agent-browser | 100% | $0.0352 | 23.4 | 23,130 |
| | plain-fetch | 93% | $0.0202 | 17.1 | 12,560 |
| Repeat visits (60 tasks) | Playwright MCP | 100% | $0.0113 | 8.5 | 25,620 |
| | pagebrief, first visit (no map) | 100% | $0.0089 | 8.8 | 4,656 |
| | **pagebrief, repeat visit (mapped)** | 100% | **$0.0032** | 8.4 | **3,947** |

What this supports:
- **Tokens:** pagebrief uses about 4.8x fewer tokens than Playwright MCP on the main track.
- **Cost:** about 1.1x cheaper per task on the main track, 1.6x with tool search on, and about 3.5x cheaper on repeat visits with a map.
- **Seconds:** not a win. Playwright MCP is about 2 seconds faster on the main track, and plain-fetch is fastest. The project goal is to beat Playwright MCP on seconds too, and this has not happened yet.

What it does not support yet:
- One repeat per task. Gaps under about 10% are noise.
- Plain-fetch scores some Hacker News answers as ok when the agent reported `NOT_FOUND`. The scorer's handling is under review, so its 92–93% is provisional.
- Costs are the CLI's list-price estimate. The runs used a subscription, not an API key.
- The repeat track measures maps on the sites they were taught on. Generalisation to unseen sites is not measured.

Full reports: [`docs/results/`](docs/results/). The map check on the taught pages gave 59 of 60 hits; the one miss (`rv-hn-2`, a missing `title` field) is open.

## Quick start

Requirements: Node 22+ and Google Chrome (or `PAGEBRIEF_CHROME` set to its path). The repository is not published to npm yet, so install from source.

```bash
git clone https://github.com/govindplal/pagebrief && cd pagebrief
npm install
npm run open -- "https://news.ycombinator.com/front?day=2016-03-15"   # print the view an agent gets
npm run open -- https://crates.io/crates/serde/1.0.100 --find downloads
npm run open -- http://localhost:3000 --allow-private                 # local pages are refused by default
```

Use it from an MCP client (Claude Code, Claude Desktop, Cursor, …):

```json
{
  "mcpServers": {
    "browser": { "command": "node", "args": ["/path/to/pagebrief/bin/pagebrief.js", "mcp"] }
  }
}
```

| Flag or variable | Effect |
|---|---|
| `--allow-private`, `PAGEBRIEF_ALLOW_PRIVATE=1` | Allow localhost and private-network pages |
| `--headed` | Show the browser window |
| `--cdp-url <url>`, `PAGEBRIEF_CDP_URL` | Drive a running browser (`ws://` or `http://host:port`) instead of launching Chrome, e.g. Lightpanda (untested against Lightpanda itself) |
| `--allow-actions <read\|write\|dangerous>` | Add the `do` tool, up to that risk level (see [Actions](#actions)) |
| `--maps <dir>\|off`, `PAGEBRIEF_MAPS_DIR`, `PAGEBRIEF_MAPS=off` | Where page maps live (default `~/.pagebrief/maps`) or turn them off |
| `--learn <model>`, `--repair <model>` | Write maps for unmapped page types, or repair failing ones, in the background |
| `--keep-hidden`, `PAGEBRIEF_KEEP_HIDDEN=1` | Keep invisible text instead of dropping it |
| `PAGEBRIEF_CHROME`, `PAGEBRIEF_CHROME_ARGS` | Chrome path; extra launch flags (e.g. `--no-sandbox` on Ubuntu CI) |

### Tools

| Tool | What it returns |
|---|---|
| `open(url)` | Title, description, structured data, a list of JSON responses the page loaded, forms, and the start of the visible text. If a map exists for the page type, its checked fields come first, and the text view is shown only where a check failed |
| `find(pattern, page?)` | Case-insensitive regex over visible text lines, links (with URLs), loaded JSON values and JSON-LD |
| `read(from, length?, page?)` | The next slice of the page text |
| `do(...)` | Only when actions are enabled: click, fill or submit, labelled read, write or dangerous, returns a diff of the page |

The CLI has the same engine: `pagebrief open`, `pagebrief teach <url>`, `pagebrief maps` (list, `export`, `import`).

## Page maps

A page type (every product page of a shop, every package page of a registry) is taught once. The map says where each named field lives. After that, plain code checks it on every load.

- **Teacher** (large model, once per page type): `pagebrief teach <url>` or `npm run bench:teach`. Default `claude-sonnet-5-5`; the benchmark maps were written with `claude-opus-5-5`.
- **Checker** (plain code, every load): reads each field, checks its type and shape. A field that is missing or the wrong kind of value fails, and the page falls back to the text view. A wrong value is never shown.
- **Student** (small model, repair only): proposes a new location when a map breaks. It is a prompted model. It is not trained or distilled. Fine-tuning is documented in [`docs/finetune.md`](docs/finetune.md) and has not been run.
- **Grader** (offline): labels failures for the evaluation report.

Where a field can live: `doc` (the page is JSON), `json` (a response the page loaded), `jsonld`, `meta`, or a label-anchored `text` regex. Regexes with nested quantifiers are rejected, so a long page cannot stall the checker. An optional field that is missing on 3 loads in a row counts as a broken location.

Maps are keyed by host and a path pattern (`*` is one segment, `**` the rest), and they stay on your machine. Sharing is explicit: `maps export` strips cost data and local hosts; `maps import` screens the bundle, marks the maps `imported`, and never overwrites your own unless you pass `--replace`. `--verify` checks each imported map against its example page.

## Actions

With `--allow-actions`, the `do` tool can click, fill and submit. Each action has a risk label, set from the element's words and its form:

| Label | Meaning | Examples |
|---|---|---|
| read | Looks at something | follow a link, search, filter, sort, page |
| write | Changes something on a server | post, save, add to cart |
| dangerous | Moves money, deletes, closes, signs out, changes credentials | pay, delete, sign out |

The level you pass is the highest label the agent may run. Labels are a guard and advice, not a promise. The server never types into password fields and never uploads files, whatever the label.

## Safety

- **Private networks are off by default.** The hostname is checked before navigating: localhost, loopback, private, link-local and carrier-NAT ranges are refused, for IPv4, IPv6 and IPv4-mapped forms, and for names that resolve inward. Every redirect hop is checked by name, and the connected address too when no proxy is in use.
- **Text hidden with `display:none` or `visibility:hidden` is dropped**, because the view is built from `innerText`. This is covered by an end-to-end test.
- **This is not protection against prompt injection.** Text hidden other ways (zero opacity, off-screen, same colour as background) is still returned, as are the meta description, JSON-LD, captured JSON, and `aria-label` text. Treat everything the tools return as untrusted page content.
- **Read-only by default.** Actions are opt-in and labelled.

Limits:
- A redirect to a private address is refused, but the request that followed it was already sent. Nothing from it reaches the agent.
- Behind a proxy, Chrome reports the proxy's address for every connection, so the connected-address check is switched off when a proxy variable is set. A system proxy on a private address that is not in the environment will refuse every page; use `--allow-private` there.
- Requests a page's own scripts make to private addresses are not blocked by this engine.

## Architecture decisions

| Decision | Chosen | Instead of | Why |
|---|---|---|---|
| Order of work | Benchmark first, engine second | Building and measuring later | Measuring showed most cost is tool definitions re-sent every turn, which set the design before any engine code existed. |
| Browser control | Raw Chrome DevTools Protocol | Playwright or Puppeteer | Direct access to the `Network` domain (capturing the page's own JSON is central), no `Runtime.enable`, and any CDP engine can replace Chrome without touching the agent-facing layer. |
| CDP transport | Node's built-in `WebSocket` | The `ws` package | One less dependency. |
| Agent-facing surface | Few tools, short descriptions | A full browser API (25–29 tools) | Definitions are re-sent every turn when loaded up front. |
| Data source order | WebMCP tools, the page's own JSON, forms and text, a model only as a last resort | DOM only | JSON the page loads is already typed. |
| Checks on maps | Plain code, fail closed | Trusting the model's locations | A wrong typed value is worse than a long text view. |
| Model in the loop | Teacher once per page type; small model only to repair | A model on every load | Keeps repeat visits cheap and deterministic. |
| Hidden content | `innerText` | `textContent` or raw HTML | Drops `display:none` and `visibility:hidden` text; see Safety for what it does not stop. |
| Network reach | Public addresses only, opt-in for private | Any http(s) URL | Pages read should not steer the agent into the user's network. |
| Concurrency | One tab, opens queued | A tab per call | Keeps each `open` correct with no extra parameters. |
| Benchmark agent | Headless Claude Code, its tools, settings and plugins off | A custom loop on the Anthropic SDK | A real agent harness on a subscription; stripping its context leaves 761 tokens of fixed overhead. |
| Benchmark sites | Scraping sandboxes, versioned pages, a Wayback snapshot | Popular live sites | Answers must not drift and pages must not block bots. Live retail and job sites block plain HTTP, and some sites serve bot checks to headless browsers; those were dropped. |
| Long runs | Repeat-major order, a usage guard, `--resume` | Running tools one after another | A run that stops early is still a balanced comparison. |
| Tests | `node:test` with `tsx` | Vitest | vitest 5.1.0's peer dependencies broke `npm install`. |

## Benchmark

60 reading tasks on 20 public sites (3 per site), with answer keys in [`bench/tasks.json`](bench/tasks.json) (main), and [`bench/tasks-repeat.json`](bench/tasks-repeat.json) (60 pages for the repeat-visit track). Each run gives one headless Claude Code agent one task and only the tool under test, mounted as an MCP server named `browser`. An answer without a tool call is scored wrong.

```bash
npm run bench -- --tool playwright-mcp,plain-fetch,pagebrief --concurrency 2   # all tasks
npm run bench -- --tool pagebrief --tasks-file bench/tasks-repeat.json          # repeat track, maps off
npm run bench -- --tool pagebrief-mapped --tasks-file bench/tasks-repeat.json   # repeat track, with maps
npm run bench -- --tool-search ...                                              # load tool definitions on demand
npm run bench -- --resume results/<runId>                                       # continue a stopped run
npm run bench:report -- results/<run-a> results/<run-b>                         # compare
npm run bench:maps   # map quality and simulated breakage, no agent
npm run bench:grade -- results/<runId>                                          # label failures
npm run bench:eval -- --run results/<runId> --map-eval <file>                   # evaluation report
```

Requires the Claude Code CLI (logged in) and Chrome. The runner reads Claude Code's rate-limit events and stops before the 5-hour window is exhausted. A run records the engine version, and `--resume` refuses to mix versions or changed maps.

Map evaluation (2026-11-11, `claude-haiku-5-5` as the repair student): 59 of 60 taught pages check out. Repair results per simulated breakage are in [`docs/results/2026-11-11-map-eval.json`](docs/results/2026-11-11-map-eval.json).

### What the benchmark does not show yet

1. **Seconds.** pagebrief is slower than Playwright MCP on the main track. The project goal says it must not be.
2. **Repeats.** One run per task. Three repeats under equal conditions are needed before the medians are firm.
3. **Unseen sites.** The repeat track measures maps on the pages they were taught on.
4. **Blocked sites.** Every task is on a site that does not block bots, logins or cookie walls. Being blocked is a bigger problem than tokens on the open web, and this benchmark says nothing about it.
5. **Fine-tuning and Lightpanda.** Neither has been measured.

## Prior art

| Idea | Who already does it | What is left |
|---|---|---|
| Fewer tokens from browser tools | Microsoft's Playwright CLI, which moves page state to disk; harnesses that load tools on demand | A small MCP surface still helps clients with neither |
| A page as text in one call | Fetch-to-markdown servers, Jina Reader, Firecrawl, Lightpanda's `markdown` tool | The text itself is not new |
| The tool surface matters more than the engine | Lightpanda's own agent benchmark | Agreement, not a gap |
| Read the page's JSON instead of its DOM | ApiTap, site2cli, and similar tools that turn a site into an API ahead of time | Doing it live, for any page, with no setup |
| Sites declare tools for agents | WebMCP in Chrome | Needs each site to opt in |
| Shared maps per page type, typed actions with risk labels, diffs | Not found in a shipped open tool | The repeat-visit bet; still early |

## Project layout

```text
bin/pagebrief.js          npx entry point
src/
  cdp/                    CDP client over the built-in WebSocket; Chrome launcher
  net/guard.ts            refuse local and private addresses
  browser.ts              one tab: navigate, settle, capture JSON, extract
  page/                   in-page extraction, JSON ranking, pure view functions
  maps/                   map types, patterns, checker (apply.ts), store, teacher, student, sharing
  actions/                risk labels, in-page action script
  engine.ts               operations, open queue, maps, learning
  mcp.ts, cli.ts          MCP server and CLI
bench/
  tasks.json, tasks-repeat.json   tasks with answer checks
  src/                    runner, scorer, report, teacher, map evaluation, grader
  scripts/                campaign driver, repeat-track builder, invisible-text measurement
docs/
  spec.md                 product spec and review notes
  finetune.md             how a student model would be fine-tuned (not run)
  results/                benchmark reports and map evaluation
```

## Development

```bash
npm test        # unit tests and end-to-end tests against headless Chrome
npm run lint    # typecheck (tsc --noEmit)
```

CI runs lint, tests, and a clean install from the packed tarball on Ubuntu and Windows.

## Roadmap

1. Make seconds competitive with Playwright MCP on the main track, and rerun with three repeats.
2. Fix the plain-fetch scoring question and the `rv-hn-2` missing-title finding.
3. Teach maps for more sites and measure them on sites they were not taught on.
4. Typed fields from captured JSON, not only `path = value` lines.
5. Fine-tune a student on the teacher's labels, and compare it with the untuned model.

See [`docs/spec.md`](docs/spec.md) for the product spec.

## License

[Apache-2.0](LICENSE)
