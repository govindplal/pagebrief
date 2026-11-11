import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { fetchText, htmlToText } from "./plain-fetch.ts";

const HTML = `<!doctype html><html><head><title>Blue &amp; Kettle</title><style>p{color:red}</style></head>
<body><script>var hidden = "nope"</script><h1>Blue Kettle</h1><p>Price: <b>1299</b>&nbsp;INR</p>
<ul><li><a href="/reviews?a=1&amp;b=2">Reviews <span>(12)</span></a></li></ul>
<table><tr><td>SKU</td><td>BK-1</td></tr></table></body></html>`;

test("htmlToText keeps title, headings, links and table cells, and drops scripts and styles", () => {
  const t = htmlToText(HTML, "https://shop.example/p/1");
  assert.match(t, /^# Blue & Kettle\n\n# Blue Kettle\nPrice: 1299 INR/);
  assert.match(t, /\[Reviews \(12\)\]\(https:\/\/shop\.example\/reviews\?a=1&b=2\)/);
  assert.match(t, /SKU\tBK-1/);
  assert.doesNotMatch(t, /nope|color:red/);
});

test("fetchText pages through a document by character offset", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<title>Long</title><body>${"<p>0123456789</p>".repeat(100)}</body>`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    const first = await fetchText(url, 0, 200);
    const next = /start_index=(\d+)/.exec(first);
    assert.ok(next, "a truncated result says where to continue");
    assert.equal(Number(next[1]), 200);
    assert.match(await fetchText(url, 200, 100000), /0123456789$/);
  } finally {
    server.close();
  }
});
