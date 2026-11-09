import assert from "node:assert/strict";
import { test } from "node:test";
import { cutText, findIn, flattenJson, readText, renderOpen, type PageData } from "./view.ts";

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
