# Agent-Native Browser Layer — One-Page Spec

Nov 7, 2026 · Govind P Lal

## Summary

An open-source browser layer that opens any web page as a typed interface for AI agents: what is on the page, what the agent can do, and what changed after each action. It works whether or not the site was built for agents. A shared, community-built map of public pages means most pages are already understood before an agent arrives.

The pitch is one number: the same task with about 10x fewer tokens and seconds than today's browser tools. That is a target to prove with the benchmark below, not a measured result.

## Problem

Websites are built for human eyes, so agents decode every page from scratch on every visit.

- Screenshots are expensive. Vision models read pixels at a high token cost and still misclick.
- HTML and accessibility trees are noisy. The agent sifts thousands of tokens of markup to find one button.
- Every step re-reads the page. After each click the agent gets the whole page again, not what changed.
- Nothing is shared. Thousands of agents decode the same public page independently, every time.
- Sites will not fix this soon. Chrome's WebMCP lets sites declare tools for agents, but developers must add code, it needs a visible tab, and headless agents are unsupported.

## How it works

Every page opens as one agent view with three parts, built by the browser rather than the site.

| Part | What the agent gets | Example |
|---|---|---|
| Content | What is on the page, as typed data | `price: 1299 (INR)`, `rating: 4.3`, `reviews: list of 20` |
| Actions | What it can do, as functions with typed inputs, each labelled read, write or dangerous | `search(query)` is read; `add_to_cart(id, qty)` is write |
| Changes | What changed after an action, as a diff | `cart_count` went from 0 to 1 |

Actions use one small, fixed vocabulary across all sites (search, filter, sort, paginate, add_to_cart, login, submit), so an agent that learns it once can use any site.

The browser builds the view from the best source on the page, falling back down the list:

1. WebMCP, if the site declares its own tools.
2. The JSON the page already loaded. Many modern sites receive their data as JSON before turning it into HTML, and the browser sees it first.
3. Forms, labels and the accessibility tree.
4. Models, as a last resort, for pages built entirely from generic elements.

The result is saved as a map per page type, since every product page on a site usually shares one layout. Elements are found by meaning (role, label, position), not CSS selectors, and the map is checked cheaply on every load.

## Architecture

The agent only ever talks to the MCP server, so the engine underneath can be swapped without touching anything above CDP.

- No engine of our own. Drive Chromium directly over CDP, the protocol Chrome's DevTools uses. Add Lightpanda later if speed or memory becomes the bottleneck.
- Diffs, not pages. After every action the server returns only what changed.
- Model tiers. Plain code does most of the work. A small open-weights decision model (to be chosen, see open questions) classifies elements and checks maps. A Gemma-class model only names unusual actions. No large model sits on the agent's path.

## Shared maps, privacy and safety

Maps of public pages can be shared; content and private pages never leave the user's machine.

- Local first. Every map is cached on the user's machine. Sharing public-page maps is opt-in, like subscribing to an ad-block filter list.
- Only structure is shared. Where the search box is and which actions exist, never prices, text or personal data. Content is always read live.
- Logged-in pages stay local. A shared crawler cannot log in as the user, so maps of an inbox, a bank portal or internal tools are built on the user's machine the first time a human visits.
- Poisoned maps. A shared map could mislabel "transfer money" as "search". Every downloaded map is checked against the live page before use.
- Dangerous actions need confirmation. Pay, delete and send are labelled dangerous, which limits what an agent can do inside a logged-in session.
- Prompt injection. Pages can hide text aimed at agents. The layer separates content from actions and drops invisible text, so agents get safer input by default.

## Version 1 scope, non-goals and roadmap

Version 1 is reading only, on public pages, shipped as an MCP server any agent can plug in with one line of config.

In version 1:
- Typed content and diffs for public pages
- Local map cache, checked on every load
- Raw CDP driving Chromium, with no Playwright
- MCP server and a small CLI
- The benchmark table in the README

Not now:
- A browser engine of its own: Chromium first, Lightpanda later, swapped through CDP
- Desktop apps
- Gmail and other apps with official APIs, where agents should use the API
- Sharing maps of logged-in pages
- A consumer browser app

Actions start only once the benchmark beats Playwright MCP; the shared map store starts only once developers use it on repeat tasks.

## Success metrics and benchmark

Success means the same task done with far fewer tokens and seconds, at equal or better accuracy, measured against Playwright MCP.

| Metric | How it is measured |
|---|---|
| Task success rate | Share of tasks answered correctly, checked against a fixed answer key |
| Tokens per task | Total input and output tokens the agent spends, end to end |
| Seconds per task | Wall-clock time from request to answer |
| Map cache hit rate | Share of page loads served from a saved map without a model call |
| Map breakage rate | Share of saved maps that fail their check on load, per week |

Benchmark: 20 public sites, 3 to 5 reading tasks each, every task run 3 times, with Playwright MCP as the baseline. The headline target is 10x fewer tokens per task at equal or better success. The other targets are set after the first baseline run, and results go in the README.

## Risks and open questions

The biggest risk is a crowded space; the answer is being a live layer for every page, plus an open shared map store.

| Risk | Response |
|---|---|
| Others already turn sites into tools or APIs: webmcp-gen, ApiTap, site2cli, Rindler, Parse | They mostly work one site at a time, set up ahead of time. This opens every page this way by default, with maps shared openly |
| Chrome builds it in | WebMCP needs site opt-in and a visible tab. This works on any site, in any agent, headless |
| Bot detection blocks automated traffic | Chromium looks normal to bot checks. Respect rate limits, and no CAPTCHA solving in version 1 |
| Sites change often: A/B tests, generated CSS class names, popups | Find elements by meaning, check maps on every load, rebuild only when the check fails |
| Canvas-drawn apps like Figma expose nothing to read | Out of scope. The agent falls back to its own vision tools |
| Small models mislabel elements | The decision model returns a confidence. Low confidence falls back to Gemma or the accessibility tree |

Open questions:
- [ ] Which developers feel this pain most: price trackers, job-application bots or portal automation?
- [ ] Where does the shared map store live, and who reviews contributions?
- [ ] Which small decision model for version 1: open weights or a paid API?
- [ ] Project name

## Review notes (2026-11-09, before any code)

1. **Baseline is soft.** Playwright MCP already sends accessibility snapshots, not screenshots, and newer tools (Vercel agent-browser, Stagehand extract, browser-use) compete on tokens. Add at least one of them to the benchmark table, not just Playwright MCP.
2. **"Typed content" hides the hard part.** Mapping a page's JSON to named fields needs a model on the first visit to each page type. Cache hit rate is what makes 10x real; say so.
3. **Bot detection is understated.** Headless Chromium over CDP is detectable (`navigator.webdriver`, `Runtime.enable` side effects). Pick benchmark sites that don't block, or run headed.
4. **Repeat visits are the wedge.** The map cache pays off only when agents revisit page types (price tracking, job listings), which answers the first open question.
5. Keep the "name this field" model call behind an interface so the model choice stays open.

## First measurement (2026-11-09, smoke run, 3 tasks x 1, not the baseline)

Playwright MCP 0.0.84 no longer returns a full snapshot on navigate. The agent used `browser_find` (regex over the page) and `browser_evaluate` (its own JS reading `innerText`); tool results were 1.7k-8k characters per task. Per task: 18k-40k tokens, 10-14 s, 2-6 tool calls, 3/3 correct.

Most of those tokens are fixed cost: ~8k tokens of system prompt + 25 tool definitions, re-sent on every turn. A 2-call task is ~17k overhead and ~1-2k page content. Implications for the 10x target:
- Shrinking page output alone cannot reach 10x on simple lookups. The levers are fewer tool definitions (a handful, not 25), fewer turns (`open(url)` returning typed content in one call), and compact results.
- Gains should be largest on multi-page and aggregate tasks, where the baseline needs many turns. The full baseline will show whether that holds.
- Report estimated cost alongside raw tokens: re-read tool definitions are cache reads, billed at about a tenth of the input price.

## Baseline, repeat 1 (2026-11-09)

60 tasks x 1 per tool, Sonnet 5.5, headless Chrome. Report: `docs/results/2026-11-09-baseline-rep1.md`.

| Tool | Success | Median tokens/task | Median s/task | Mean tool calls |
|---|---|---|---|---|
| Playwright MCP 0.0.84 | 95% | 26,402 | 14.3 | 3.0 |
| agent-browser 0.41.2 | 95% | 77,514 | 17.1 | 2.3 |

- The 10x headline target against Playwright MCP means a median of about 2,600 tokens per task at 95%+ success.
- Proposed non-headline targets, to confirm: median seconds per task at or below Playwright MCP's (14.3 s); mean tool calls at or below 1.5.
- agent-browser is the costlier baseline: its tool definitions are ~3x Playwright's, re-sent every turn. Review note 1 holds anyway: report both.
- Open Library added a human-verification page for headless browsers; its three tasks fail for both tools and should be replaced with another stable site.

## Engine v0.1 (2026-11-09)

Raw CDP on headless installed Chrome with three read-only tools: `open(url)` (title, JSON-LD, JSON the page loaded, forms, first ~3k characters of text), `find(pattern)` and `read(from)`. First smoke run: books.toscrape.com category lookup correct in 13,820 tokens (Playwright MCP 34,192, agent-browser 69,768 on the same task), but 24.5 s against 19.8 s. Full 60-task run pending.
