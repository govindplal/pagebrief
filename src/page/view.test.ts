import assert from "node:assert/strict";
import { test } from "node:test";
import { cutText, detectBlock, findIn, flattenJson, readText, renderOpen, textStart, type PageData } from "./view.ts";

const page = (over: Partial<PageData> = {}): PageData => ({
  url: "https://shop.example/p/1",
  title: "Blue Kettle",
  description: "A kettle",
  lang: "en",
  text: "Blue Kettle\nPrice: 1299 INR\nRating 4.3\nIn stock",
  headings: [{ level: 1, text: "Blue Kettle" }],
  links: [{ text: "Reviews", href: "https://shop.example/p/1/reviews" }],
  forms: [{ action: "https://shop.example/search", method: "get", fields: [{ name: "q", type: "search", label: "Search" }] }],
  jsonLd: ['{"@context":"https://schema.org","@type":"Product","offers":{"price":"1299","priceCurrency":"INR"}}', "{not json"],
  json: [{ url: "https://shop.example/api/p/1", status: 200, data: { id: 1, reviews: [{ stars: 5 }, { stars: 3 }] } }],
  ...over,
});

test("flattenJson produces searchable path = value lines", () => {
  assert.deepEqual(flattenJson({ a: { b: [1, "x"] }, c: null, d: [] }), ["a.b[0] = 1", 'a.b[1] = "x"', "c = null", "d = []"]);
  assert.deepEqual(flattenJson(7), [". = 7"]);
  assert.equal(flattenJson({ xs: Array.from({ length: 100 }, (_, i) => i) }, "", [], 10).length, 10);
});

test("renderOpen shows title, structured data, JSON, forms and text in one view", () => {
  const v = renderOpen(page());
  assert.match(v, /^# Blue Kettle\nurl: https:\/\/shop\.example\/p\/1/);
  assert.match(v, /offers\.price = "1299"/);
  assert.doesNotMatch(v, /@context/);
  assert.match(v, /json#1 https:\/\/shop\.example\/api\/p\/1 \{id, reviews\}/);
  assert.match(v, /form: GET https:\/\/shop\.example\/search ← q "Search"/);
  assert.match(v, /Price: 1299 INR/);
  assert.match(v, /\[1 links: find\(pattern\) returns their URLs\]/);
});

test("renderOpen truncates long text at a line break and points to read()", () => {
  const text = Array.from({ length: 200 }, (_, i) => `line ${i} ${"x".repeat(30)}`).join("\n");
  const v = renderOpen(page({ text }), 1000);
  const cut = cutText(text, 1000);
  assert.ok(cut <= 1000 && text[cut] === "\n");
  assert.match(v, new RegExp(`text \\(first ${cut} of ${text.length} chars\\)`));
  assert.match(v, new RegExp(`\\[more: read\\(from=${cut}\\)`));
});

test("findIn searches text, links, loaded JSON and JSON-LD", () => {
  const r = findIn(page(), "1299");
  assert.match(r, /^2 matches/);
  assert.match(r, /L2: Price: 1299 INR/);
  assert.match(r, /ld offers\.price = "1299"/);
  assert.match(findIn(page(), "reviews"), /link: Reviews -> https:\/\/shop\.example\/p\/1\/reviews/);
  assert.match(findIn(page(), "stars"), /json#1 reviews\[1\]\.stars = 3/);
  assert.equal(findIn(page(), "nothing-here"), "no matches for /nothing-here/i");
});

test("findIn treats an invalid regex as a literal", () => {
  assert.match(findIn(page({ text: "cost (USD" }), "(USD"), /L1: cost \(USD/);
});

test("readText pages through the text", () => {
  const p = page({ text: "abcdefghij" });
  assert.equal(readText(p, 3, 4), "text 3-7 of 10:\ndefg\n[more: read(from=7)]");
  assert.equal(readText(p, 7), "text 7-10 of 10:\nhij\n[end of text]");
});

test("a JSON document is searched by path, and a hit deep in a minified line stays visible", () => {
  const doc = { packages: { "laravel/framework": [{ version: "v10.0.0", require: { php: "^8.1" } }, { version: "v9.0.0", time: "2022-02-08T15:48:00+00:00" }] } };
  const p = page({ url: "https://repo.example/p2.json", text: JSON.stringify(doc), json: [], jsonLd: [], links: [], forms: [] });
  assert.match(findIn(p, "v9\\.0\\.0"), /doc packages\.laravel\/framework\[1\]\.version = "v9\.0\.0"/);
  assert.match(findIn(p, "2022-02-08"), /time = "2022-02-08/);
  const v = renderOpen(p);
  assert.match(v, /json document: \{packages\}, \d+ values/);
  assert.doesNotMatch(v, /\ntext/);
});

test("around() keeps the match in view on a long line", () => {
  const long = "x".repeat(1000) + "NEEDLE" + "y".repeat(1000);
  assert.match(findIn(page({ text: long }), "NEEDLE"), /L1: …x{120}NEEDLE/);
});

test("a large JSON document is searched from its captured response, not its cut-off text", () => {
  const doc = { packages: { x: [{ version: "v10.0.0", require: { php: "^8.1" } }] } };
  const p = page({ url: "https://repo.example/p2.json#v10", text: JSON.stringify(doc).slice(0, 30), json: [{ url: "https://repo.example/p2.json", status: 200, data: doc }], jsonLd: [], links: [], forms: [] });
  assert.match(findIn(p, "php"), /doc packages\.x\[0\]\.require\.php = "\^8\.1"/);
});

test("search reaches values past the first 5,000 in a large document", () => {
  const big = { list: Array.from({ length: 6000 }, (_, i) => ({ version: `v${i}.0.0` })) };
  const p = page({ url: "https://repo.example/big.json", text: JSON.stringify(big), json: [{ url: "https://repo.example/big.json", status: 200, data: big }], jsonLd: [], links: [], forms: [] });
  assert.match(findIn(p, "v5999\.0\.0"), /doc list\[5999\]\.version = "v5999\.0\.0"/);
});

test("open() starts at the main content when a long site header comes first", () => {
  const header = "Menu\n" + "nav link\n".repeat(60);
  const main = "Kettle guide\n" + "Useful sentence about kettles.\n".repeat(20);
  const p = page({ text: header + main, mainStart: header.length });
  const v = renderOpen(p, 200);
  assert.match(v, new RegExp(`text \\(main content, chars ${header.length}-\\d+ of ${p.text.length}; site header before it: read\\(from=0\\)\\):\\nKettle guide`));
  assert.doesNotMatch(v, /nav link/);
  assert.match(v, /\[more: read\(from=\d+\)/);
  assert.match(findIn(p, "nav link"), /^60 matches/, "the skipped header is still searchable");
});

test("open() keeps the top of the page when the header is short or main is nearly empty", () => {
  assert.equal(textStart({ text: "x".repeat(5000), mainStart: 120 }), 0);
  assert.equal(textStart({ text: "x".repeat(1000), mainStart: 900 }), 0);
  assert.equal(textStart({ text: "x".repeat(5000) }), 0);
  assert.equal(textStart({ text: "x".repeat(5000), mainStart: 800 }), 800);
});

test("find() refuses very long patterns and stops when it runs out of time", () => {
  assert.throws(() => findIn(page(), "a".repeat(301)), /keep it under 300/);
  const big = page({ text: Array.from({ length: 5000 }, (_, i) => `line ${i}`).join("\n") });
  assert.match(findIn(big, "line", 40, -1), /search stopped after -1 ms; results are partial/);
  assert.match(findIn(big, "line 4999"), /^1 matches/);
});

test("a bot check or a login wall is reported, not returned as content", () => {
  const sig = { challenge: false, hasPassword: false, hiddenChars: 0, hiddenElements: 0 };
  const cf = page({ title: "Just a moment...", text: "Checking if the site connection is secure", signals: sig });
  assert.equal(detectBlock(cf)?.kind, "bot check");
  const v = renderOpen(cf);
  assert.match(v, /^# Just a moment\.\.\.\nurl: .*\nblocked: this looks like a bot check \(title "Just a moment\.\.\."\), not the page's content/);
  assert.match(v, /\[read\(from=0\) shows its \d+ chars of text anyway\]$/);
  assert.equal(detectBlock(page({ title: "Books", text: "Please verify you are a human to continue." }))?.kind, "bot check");
  assert.equal(detectBlock(page({ title: "Shop", text: "x", signals: { ...sig, challenge: true } }))?.kind, "bot check");
  assert.equal(detectBlock(page({ url: "https://site.example/login?next=/", title: "Welcome", text: "Email\nPassword", signals: { ...sig, hasPassword: true } }))?.kind, "login wall");
  // Long pages that merely mention a captcha, and ordinary pages with a sign-in box, are content.
  assert.equal(detectBlock(page({ title: "How CAPTCHA works", text: "captcha ".repeat(1000) })), null);
  assert.equal(detectBlock(page({ title: "Blue Kettle", signals: { ...sig, hasPassword: true } })), null);
  assert.equal(detectBlock(page()), null);
});
