import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { findChrome } from "../cdp/chrome.ts";
import { Engine } from "../engine.ts";
import { allowed, classify, neverAllowed, type ActionInfo } from "./risk.ts";

const hasChrome = (() => {
  try {
    findChrome();
    return true;
  } catch {
    return false;
  }
})();

const a = (over: Partial<ActionInfo>): ActionInfo => ({ kind: "button", text: "", form: null, ...over });
const post = { method: "post", action: "https://shop.example/cart" };
const get = { method: "get", action: "https://shop.example/search" };

test("risk labels: read for looking, write for changing, dangerous for money, deletion and sign-out", () => {
  assert.equal(classify(a({ kind: "link", text: "Next page", href: "https://x.example/?page=2" })), "read");
  assert.equal(classify(a({ kind: "link", text: "Product details", href: "https://x.example/p/1" })), "read");
  assert.equal(classify(a({ kind: "link", text: "Sign out", href: "https://x.example/logout" })), "dangerous");
  assert.equal(classify(a({ kind: "link", text: "Account", href: "https://x.example/account/delete" })), "dangerous");
  assert.equal(classify(a({ kind: "link", text: "Add", href: "https://x.example/cart/add?id=3" })), "write");
  assert.equal(classify(a({ text: "Show more" })), "read");
  assert.equal(classify(a({ text: "Search", form: get, submits: true })), "read");
  assert.equal(classify(a({ text: "Add to cart", form: post, submits: true })), "write");
  assert.equal(classify(a({ text: "Post comment", form: post, submits: true })), "write");
  assert.equal(classify(a({ text: "Buy now", form: post, submits: true })), "dangerous");
  assert.equal(classify(a({ text: "Delete account" })), "dangerous");
  assert.equal(classify(a({ text: "Confirm order", form: post, submits: true })), "dangerous");
  assert.equal(classify(a({ text: "Unsubscribe" })), "dangerous");
  assert.equal(classify(a({ text: "Do the thing" })), "write", "an unknown button is assumed to write");
  assert.equal(classify(a({ kind: "text", text: "Search", form: get }), true), "read");
  assert.equal(classify(a({ kind: "text", text: "Comment", form: post }), false), "read", "typing alone changes nothing");
  assert.equal(classify(a({ kind: "text", text: "Comment", form: post }), true), "write");
  assert.equal(classify(a({ kind: "select", text: "Sort by", form: get }), true), "read");
  assert.ok(allowed("read", "write") && allowed("write", "write") && !allowed("dangerous", "write") && !allowed("write", "read"));
  assert.ok(neverAllowed(a({ kind: "password", text: "Password" })) && neverAllowed(a({ kind: "file" })) && !neverAllowed(a({ kind: "text" })));
});

const SHOP = `<!doctype html><html><head><title>Kettle shop</title></head><body>
<h1>Kettles</h1>
<form action="/search" method="get"><input name="q" placeholder="Search kettles"><button type="submit">Search</button></form>
<label for="sort">Sort by</label><select id="sort"><option>Price</option><option>Name</option></select>
<ul id="list"><li>Blue Kettle</li><li>Red Kettle</li></ul>
<button id="more" onclick="document.getElementById('list').insertAdjacentHTML('beforeend','<li>Green Kettle</li>')">Show more</button>
<a href="/page2">Next page</a>
<a href="/logout">Sign out</a>
<a href="http://127.0.0.1:1/private">Elsewhere</a>
<form action="/cart" method="post"><button type="submit">Add to cart</button></form>
<button onclick="void 0">Delete account</button>
<form action="/login" method="post"><input type="password" name="pw" placeholder="Password"><button type="submit">Log in</button></form>
</body></html>`;

let server: http.Server;
let base = "";
const hits: string[] = [];

before(async () => {
  server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "content-type": "text/html" });
    if (req.url?.startsWith("/search")) {
      const q = new URL(req.url, "http://x").searchParams.get("q");
      res.end(`<!doctype html><title>Results</title><h1>Results for ${q}</h1><p>1 kettle found</p><a href="/">Back</a>`);
    } else if (req.url === "/page2") res.end(`<!doctype html><title>Page 2</title><h1>Page 2</h1><p>Silver Kettle</p>`);
    else if (req.url === "/") res.end(SHOP);
    else res.end(`<!doctype html><title>Other</title><p>${req.method} ${req.url}</p>`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.closeAllConnections();
  server.close();
});

const make = (allow: "read" | "write" | "dangerous" | null) =>
  new Engine({ settleTimeoutMs: 3000, allowPrivate: true, extraArgs: ["--no-proxy-server"], actions: allow ? { allow } : undefined });

test("open lists actions with risk labels; passwords are never listed", { skip: !hasChrome, timeout: 60_000 }, async () => {
  const e = make("read");
  try {
    const view = await e.open(`${base}/`);
    assert.match(view, /actions \(\d+ of \d+; do\(id, value\?, submit\?\); this server allows read actions\):/);
    assert.match(view, /\[read\] text "Search kettles"/);
    assert.match(view, /\[read\] select "Sort by" \[Price\|Name\]/);
    assert.match(view, /\[read\] button "Show more"/);
    assert.match(view, /\[read\] link "Next page"/);
    assert.match(view, /\[dangerous\] link "Sign out"/);
    assert.match(view, /\[write\] button "Add to cart"/);
    assert.match(view, /\[dangerous\] button "Delete account"/);
    assert.doesNotMatch(view, /a\d+ \[\w+\] .*[Pp]assword/);
  } finally {
    await e.close();
  }
});

test("do: read actions work and return only what changed; others are refused before anything is sent", { skip: !hasChrome, timeout: 90_000 }, async () => {
  const e = make("read");
  try {
    const view = await e.open(`${base}/`);
    const id = (re: RegExp) => re.exec(view)![1]!;
    // A click that changes the page in place: a diff.
    const more = await e.act(id(/(a\d+) \[read\] button "Show more"/));
    assert.match(more, /^did a\d+ \[read\] button "Show more"\nsame page \(p1\): 1 line added, 0 removed:\n\+ Green Kettle\n/);
    // The diff is against the page as it was just before the action.
    assert.match(await e.act(id(/(a\d+) \[read\] button "Show more"/)), /1 line added, 0 removed:\n\+ Green Kettle/);
    assert.match(e.find("Green"), /2 matches/, "find sees the updated page");
    // Choosing an option, then a search that navigates.
    assert.match(await e.act(id(/(a\d+) \[read\] select "Sort by"/), "Name"), /did a\d+ \[read\] select "Sort by" = "Name"\nsame page/);
    const search = await e.act(id(/(a\d+) \[read\] text "Search kettles"/), "teapot", true);
    assert.match(search, /^did a\d+ \[read\] text "Search kettles" = "teapot" \+ submit\nnavigated to .*\/search\?q=teapot\n\n# Results\n/);
    assert.match(search, /Results for teapot/);
    assert.match(search, /\nactions \(/, "the new page's actions are listed");
    assert.match(e.find("found"), /page p2: .*\n1 matches/);

    // Refusals: nothing reaches the server.
    await e.open(`${base}/`);
    hits.length = 0;
    await assert.rejects(e.act(id(/(a\d+) \[write\] button "Add to cart"/)), /refused: a\d+ \[write\] button "Add to cart" is a write action and this server allows read actions only; start it with --allow-actions write/);
    await assert.rejects(e.act(id(/(a\d+) \[dangerous\] link "Sign out"/)), /is a dangerous action/);
    await assert.rejects(e.act("a999"), /no action "a999"/);
    await assert.rejects(e.act("nonsense"), /no action "nonsense"/);
    assert.deepEqual(hits.filter((h) => !h.startsWith("GET / ")), [], "refused actions sent nothing");
  } finally {
    await e.close();
  }
});

test("do: a server that allows write performs writes, never dangerous ones, and checks where links lead", { skip: !hasChrome, timeout: 90_000 }, async () => {
  const e = make("write");
  try {
    const view = await e.open(`${base}/`);
    const id = (re: RegExp) => re.exec(view)![1]!;
    hits.length = 0;
    const cart = await e.act(id(/(a\d+) \[write\] button "Add to cart"/));
    assert.match(cart, /navigated to .*\/cart/);
    assert.deepEqual(hits.filter((h) => h.startsWith("POST")), ["POST /cart"]);
    await e.open(`${base}/`);
    await assert.rejects(e.act(id(/(a\d+) \[dangerous\] button "Delete account"/)), /allows write actions only; start it with --allow-actions dangerous/);
  } finally {
    await e.close();
  }
  // With the private-network guard on, a link to a private address is refused before the click.
  const guarded = new Engine({ settleTimeoutMs: 3000, checkRemoteAddress: false, actions: { allow: "read" }, extraArgs: ["--no-proxy-server", "--host-resolver-rules=MAP shop.invalid 127.0.0.1"] });
  try {
    const port = new URL(base).port;
    const view = await guarded.open(`http://shop.invalid:${port}/`);
    const elsewhere = /(a\d+) \[read\] link "Elsewhere"/.exec(view)![1]!;
    await assert.rejects(guarded.act(elsewhere), /127\.0\.0\.1 is a local or private address/);
  } finally {
    await guarded.close();
  }
});

test("do is off unless actions are enabled, and an action id from an older page is refused", { skip: !hasChrome, timeout: 60_000 }, async () => {
  const off = make(null);
  try {
    assert.doesNotMatch(await off.open(`${base}/`), /actions \(/);
    await assert.rejects(off.act("a1"), /actions are off/);
  } finally {
    await off.close();
  }
  const e = make("read");
  try {
    await e.open(`${base}/`);
    await e.open(`${base}/page2`);
    await assert.rejects(e.act("a1", undefined, undefined, "p1"), /actions work on the page the browser is showing, p2/);
  } finally {
    await e.close();
  }
});
