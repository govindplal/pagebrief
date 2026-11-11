import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { renderOpen, type PageData } from "../page/view.ts";
import { applyMap, getPath, numberIn, parsePath, readField, unsafeRegex } from "./apply.ts";
import { parseJsonReply, type Llm } from "./llm.ts";
import { hostKey, matchPattern, proposePattern } from "./pattern.ts";
import { exportMaps, importMaps, verifyMap } from "./share.ts";
import { FileMapStore } from "./store.ts";
import { LlmStudent } from "./student.ts";
import { finishMap, LlmTeacher } from "./teacher.ts";
import type { PageMap } from "./types.ts";

const page = (over: Partial<PageData> = {}): PageData => ({
  url: "https://shop.example/catalogue/blue-kettle_12/index.html",
  title: "Blue Kettle",
  description: "",
  lang: "en",
  text: "Blue Kettle\nPrice (incl. tax)\t£1,299.50\nAvailability\tIn stock (7 available)\nUPC\tab12cd",
  headings: [],
  links: [],
  forms: [],
  jsonLd: ['{"@context":"https://schema.org","@graph":[{"@type":"Product","sku":"BK-1","offers":{"price":"1299.50","priceCurrency":"GBP"}}]}'],
  json: [{ url: "https://shop.example/api/items/12?x=1", status: 200, data: { item: { stock: 7, tags: [{ n: "a" }, { n: "b" }] } } }],
  meta: { "og:type": "product" },
  ...over,
});

const kettleMap = (): PageMap => ({
  version: 1,
  host: "shop.example",
  pattern: "/catalogue/*/index.html",
  pageType: "product page",
  fields: [
    { name: "price", type: "number", unit: "GBP", example: "1299.50", at: { from: "text", regex: "Price \\(incl\\. tax\\)\\s+(\\S+)" } },
    { name: "sku", type: "string", example: "BK-1", at: { from: "jsonld", path: "sku" } },
    { name: "stock", type: "integer", example: "7", at: { from: "json", url: "/api/items/*", path: "item.stock" } },
    { name: "tags", type: "list", example: "a, b", at: { from: "json", url: "/api/items/*", path: "item.tags[*].n" } },
    { name: "kind", type: "string", example: "product", at: { from: "meta", name: "og:type" } },
    { name: "sale_price", type: "number", optional: true, example: "", at: { from: "text", regex: "Sale price\\s+(\\S+)" } },
  ],
  exampleUrl: "https://shop.example/catalogue/blue-kettle_12/index.html",
  createdAt: "2026-11-11T00:00:00.000Z",
  source: "teacher",
});

test("two pages of one type resolve to the same pattern; other page types do not", () => {
  const a = "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html";
  const b = "https://books.toscrape.com/catalogue/tipping-the-velvet_999/index.html";
  assert.equal(proposePattern(a), "/catalogue/*/index.html");
  assert.ok(matchPattern(proposePattern(a), b));
  assert.ok(!matchPattern(proposePattern(a), "https://books.toscrape.com/catalogue/category/books_1/index.html"));
  assert.equal(proposePattern("https://pypi.org/project/requests/2.31.0/"), "/project/*/*");
  assert.ok(matchPattern("/project/*/*", "https://pypi.org/project/flask/3.0.0"));
  assert.ok(matchPattern("/item", "https://news.ycombinator.com/item?id=1"));
  assert.ok(matchPattern("/docs/**", "https://x.dev/docs/a/b/c"));
  assert.equal(hostKey("https://WWW.Example.com/x"), "example.com");
});

test("paths parse the syntax find() prints", () => {
  assert.deepEqual(parsePath('a.b[0]["odd.key"][*].c'), [{ key: "a" }, { key: "b" }, { index: 0 }, { key: "odd.key" }, { all: true }, { key: "c" }]);
  assert.deepEqual(getPath({ xs: [{ n: 1 }, { n: 2 }, {}] }, "xs[*].n"), [1, 2]);
  assert.equal(getPath({ a: [5] }, "a[0]"), 5);
  assert.equal(getPath({ a: 1 }, "a.b.c"), undefined);
  assert.equal(numberIn("£1,299.50 incl."), "1299.50");
  assert.ok(unsafeRegex("(a+)+b") && unsafeRegex("(\\w*)*") && !unsafeRegex("Price\\s+(\\S+)"));
});

test("a map reads typed fields from text, JSON-LD (@graph), captured JSON and meta tags", () => {
  const r = applyMap(kettleMap(), page());
  assert.ok(r.ok);
  const v = Object.fromEntries(r.fields.map((f) => [f.name, f.ok ? f.value : `FAIL ${f.reason}`]));
  assert.deepEqual(v, { price: "1299.50", sku: "BK-1", stock: "7", tags: "a, b", kind: "product", sale_price: "FAIL missing" });
});

test("a field that fails its check is never shown, and the text view follows", () => {
  const broken = page({ text: "Blue Kettle\nPrice (incl. tax)\tcall us\nUPC\tab12cd" });
  const r = applyMap(kettleMap(), broken);
  assert.ok(!r.ok);
  assert.match(r.fields.find((f) => f.name === "price")!.reason!, /not a number/);
  const view = renderOpen(broken, 3000, { map: r });
  assert.match(view, /5 of 6 fields checked; failed, so the page follows \(the map may be stale\): price \(".*" is not a number\)/);
  assert.doesNotMatch(view, /\n  price = /);
  assert.match(view, /sku = BK-1/);
  assert.match(view, /text:\nBlue Kettle/);
});

test("with a valid map, open leads with the fields and leaves the text out", () => {
  const view = renderOpen(page(), 3000, { map: applyMap(kettleMap(), page()), pageId: "p2" });
  assert.match(view, /^# Blue Kettle\nurl: .*\npage: p2\npage map: product page \(shop\.example \/catalogue\/\*\/index\.html\), 6 fields checked:\n  price = 1299\.50 GBP\n/);
  assert.match(view, /sale_price = \(none\)/);
  assert.match(view, /\[text not shown \(\d+ chars\): find\(pattern\) or read\(from=0\)/);
  assert.doesNotMatch(view, /Availability/);
});

test("type checks: integers, dates, URLs, booleans and value shapes", () => {
  const p = page({ text: "Count: 7.5\nDate: soon\nHome: /about\nNew: maybe\nCode: ab12cd" });
  const f = (type: PageMap["fields"][number]["type"], label: string, shape?: string) =>
    readField({ name: "x", type, example: "", shape, at: { from: "text", regex: `${label}: (.+)` } }, p);
  assert.match(f("integer", "Count").reason!, /not a whole number/);
  assert.match(f("date", "Date").reason!, /not a date/);
  assert.equal(f("url", "Home").value, "https://shop.example/about");
  assert.match(f("boolean", "New").reason!, /not true\/false/);
  assert.match(f("string", "Code", "^\\d+$").reason!, /does not match/);
  assert.equal(f("string", "Code", "^[a-z0-9]+$").value, "ab12cd");
});

test("finishMap keeps only fields whose location gives back the teacher's example", () => {
  const draft = {
    pageType: "product page",
    pattern: "/catalogue/*/index.html",
    fields: [
      ...kettleMap().fields.slice(0, 3),
      { name: "wrong", type: "string", example: "Red Kettle", at: { from: "jsonld", path: "sku" } },
      { name: "evil", type: "string", example: "x", at: { from: "text", regex: "(a+)+" } },
      { name: "Bad Name", type: "string", example: "x", at: { from: "meta", name: "og:type" } },
    ],
  };
  const { map, dropped } = finishMap(draft, page(), undefined);
  assert.deepEqual(map.fields.map((f) => f.name), ["price", "sku", "stock"]);
  assert.deepEqual(dropped.map((d) => d.name).sort(), ["Bad Name", "evil", "wrong"]);
  assert.equal(map.host, "shop.example");
  // A pattern that does not match the page itself is replaced by the proposed one.
  assert.equal(finishMap({ ...draft, pattern: "/elsewhere/*" }, page(), undefined).map.pattern, "/catalogue/*/index.html");
  assert.throws(() => finishMap({ fields: [draft.fields[3]] }, page(), undefined), /no field .* checked out/);
});

const fakeLlm = (reply: unknown): Llm & { prompts: string[] } => {
  const prompts: string[] = [];
  return {
    name: "fake",
    prompts,
    complete: async (_s, prompt) => {
      prompts.push(prompt);
      return { text: `Here you go:\n\`\`\`json\n${JSON.stringify(reply)}\n\`\`\``, usage: { model: "fake", costUsd: 0.01, tokens: 100, seconds: 1 } };
    },
  };
};

test("the teacher sends every source in map syntax and returns a checked map", async () => {
  const llm = fakeLlm({ pageType: "product page", pattern: "/catalogue/*/index.html", fields: kettleMap().fields.slice(0, 2) });
  const { map } = await new LlmTeacher(llm).teach(page());
  assert.equal(map.teacher?.costUsd, 0.01);
  assert.match(llm.prompts[0]!, /JSON-LD \(from: jsonld, path\):\n@context = .*\n@graph\[0\]\.@type = "Product"/);
  assert.match(llm.prompts[0]!, /JSON RESPONSE https:\/\/shop\.example\/api\/items\/12\?x=1 .*\nitem\.stock = 7/);
  assert.match(llm.prompts[0]!, /META TAGS .*\nog:type = product/);
  assert.match(llm.prompts[0]!, /VISIBLE TEXT .*\nBlue Kettle/);
  assert.deepEqual(parseJsonReply('ok {"a": {"b": 1}} done'), { a: { b: 1 } });
});

test("the student repairs a broken field only when it is confident and the repair checks out", async () => {
  const moved = page({ text: "Blue Kettle\nOur price: £1,350.00\nUPC\tab12cd" });
  const broken = applyMap(kettleMap(), moved);
  const good = new LlmStudent(fakeLlm({ fields: [{ name: "price", confident: true, at: { from: "text", regex: "Our price: (\\S+)" } }] }));
  const repaired = await good.repair(broken, moved);
  assert.ok(repaired);
  assert.equal(repaired.source, "student");
  assert.deepEqual(repaired.repairs?.[0]?.fields, ["price"]);
  assert.equal(applyMap(repaired, moved).fields[0]!.value, "1350.00");

  const unsure = new LlmStudent(fakeLlm({ fields: [{ name: "price", confident: false, at: { from: "text", regex: "Our price: (\\S+)" } }] }));
  assert.equal(await unsure.repair(broken, moved), null);
  const wrong = new LlmStudent(fakeLlm({ fields: [{ name: "price", confident: true, at: { from: "text", regex: "UPC\\t(\\S+)" } }] }));
  assert.equal(await wrong.repair(broken, moved), null, "a repair that gives a non-number for a price fails the check");
});

test("the file store finds the most specific matching map and survives a bad file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pagebrief-maps-"));
  try {
    const store = new FileMapStore(dir);
    store.save(kettleMap());
    store.save({ ...kettleMap(), pattern: "/**", pageType: "any page" });
    assert.equal(store.find("https://www.shop.example/catalogue/x_1/index.html")?.pageType, "product page");
    assert.equal(store.find("https://shop.example/about")?.pageType, "any page");
    assert.equal(store.find("https://other.example/catalogue/x_1/index.html"), undefined);
    assert.equal(store.list().length, 2);
    fs.writeFileSync(path.join(dir, "shop.example.json"), "{oops");
    assert.equal(new FileMapStore(dir).find("https://shop.example/about"), undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("sharing: public maps export without cost data, local hosts are left out, imports are screened and marked", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pagebrief-share-"));
  try {
    const mine = new FileMapStore(path.join(dir, "mine"));
    mine.save({ ...kettleMap(), teacher: { model: "m", costUsd: 1, tokens: 1, seconds: 1 }, source: "student" });
    mine.save({ ...kettleMap(), host: "localhost", exampleUrl: "http://localhost/catalogue/a/index.html" });
    mine.save({ ...kettleMap(), host: "192.168.1.5", exampleUrl: "http://192.168.1.5/catalogue/a/index.html" });
    const { bundle, skipped } = exportMaps(mine, undefined);
    assert.deepEqual(bundle.maps.map((m) => m.host), ["shop.example"]);
    assert.equal(bundle.maps[0]!.teacher, undefined);
    assert.equal(bundle.maps[0]!.source, "teacher");
    assert.deepEqual(skipped.map((s) => s.split(" ")[0]).sort(), ["192.168.1.5/catalogue/*/index.html", "localhost/catalogue/*/index.html"]);

    const theirs = new FileMapStore(path.join(dir, "theirs"));
    const evil = { ...kettleMap(), host: "evil.example", exampleUrl: "https://evil.example/catalogue/x/index.html", fields: [{ ...kettleMap().fields[0]!, at: { from: "text", regex: "(a+)+$" } }] };
    const wrongHost = { ...kettleMap(), exampleUrl: "https://elsewhere.example/catalogue/x/index.html" };
    const noMatch = { ...kettleMap(), exampleUrl: "https://shop.example/other/x" };
    const junk = { host: 1 };
    const report = await importMaps({ ...bundle, maps: [...bundle.maps, evil, wrongHost, noMatch, junk] }, theirs, { from: "friend.json" });
    assert.deepEqual(report.imported, ["shop.example/catalogue/*/index.html"]);
    assert.deepEqual(report.rejected.map((r) => r.why.split(":")[0]), ["field price", "the example URL is on a different host", "the pattern does not match the map's own example URL", "invalid"]);
    const got = theirs.find("https://shop.example/catalogue/a/index.html")!;
    assert.equal(got.source, "imported");
    assert.equal(got.importedFrom, "friend.json");
    // A map you already have is kept unless you say so.
    const again = await importMaps(bundle, theirs, { from: "x" });
    assert.match(again.rejected[0]!.why, /already have a imported map/);
    assert.equal((await importMaps(bundle, theirs, { from: "x", replace: true })).imported.length, 1);
    await assert.rejects(importMaps({ format: "other" }, theirs, { from: "x" }), /not a pagebrief-maps\/1 bundle/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("verifying a shared map keeps only the fields that still read the example value", () => {
  const stale = { ...kettleMap(), fields: kettleMap().fields.map((f) => (f.name === "price" ? { ...f, example: "999.00" } : f)) };
  const { map, dropped } = verifyMap(stale, page());
  assert.deepEqual(dropped.map((d) => d.name), ["price", "sale_price"]);
  assert.match(dropped[0]!.why, /reads "1299.50", the map says "999.00"/);
  assert.deepEqual(map!.fields.map((f) => f.name), ["sku", "stock", "tags", "kind"]);
  assert.equal(verifyMap({ ...kettleMap(), fields: [kettleMap().fields[0]!] }, page({ text: "nothing" })).map, null);
});

test("the Ollama client posts the prompt and reports token counts", async () => {
  const http = await import("node:http");
  let body: { model: string; format: string; messages: { role: string; content: string }[] } | undefined;
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      body = JSON.parse(raw);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: { content: '{"fields":[]}' }, prompt_eval_count: 120, eval_count: 30 }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const { Ollama, llmFromSpec } = await import("./llm.ts");
    const reply = await new Ollama("gemma3:4b", `http://127.0.0.1:${(server.address() as { port: number }).port}`).complete("sys", "user");
    assert.equal(reply.text, '{"fields":[]}');
    assert.deepEqual({ model: reply.usage.model, tokens: reply.usage.tokens, cost: reply.usage.costUsd }, { model: "ollama:gemma3:4b", tokens: 150, cost: 0 });
    assert.deepEqual({ model: body!.model, format: body!.format, roles: body!.messages.map((m) => m.role) }, { model: "gemma3:4b", format: "json", roles: ["system", "user"] });
    assert.equal(llmFromSpec("ollama:gemma3:4b").name, "ollama:gemma3:4b");
    assert.equal(llmFromSpec("claude-haiku-5-5").name, "claude-haiku-5-5");
  } finally {
    server.close();
  }
});
