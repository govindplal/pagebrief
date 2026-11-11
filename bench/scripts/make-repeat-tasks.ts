// Builds bench/tasks-repeat.json, the repeat-visit track: on each of six sites,
// one page of a type for the teacher and ten more pages of the same type for
// the agent. Every answer is read here from the site's HTML or its public API
// (regex and JSON.parse only), never written by hand.
//   npx tsx bench/scripts/make-repeat-tasks.ts
import fs from "node:fs";
import type { Check } from "../src/check.ts";

interface Task {
  id: string;
  site: string;
  url: string;
  kind: string;
  question: string;
  check: Check;
}

const UA = { "user-agent": "pagebrief-benchmark/0.3 (+https://github.com/govindplal/pagebrief)" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: UA });
    if (res.ok) return res.text();
    if (attempt >= 2) throw new Error(`${url}: HTTP ${res.status}`);
    await sleep(2000);
  }
}
const json = async <T>(url: string): Promise<T> => JSON.parse(await get(url)) as T;
const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
const day = (iso: string) => iso.slice(0, 10);
const one = (re: RegExp, s: string, what: string): string => {
  const m = re.exec(s);
  if (!m) throw new Error(`not found: ${what}`);
  return decode(m[1]!);
};

const teach: { site: string; url: string }[] = [];
const tasks: Task[] = [];
const add = (site: string, prefix: string, i: number, url: string, question: string, check: Check) =>
  tasks.push({ id: `${prefix}-${i + 1}`, site, url, kind: "repeat", question, check });

// 1. books.toscrape.com: book pages (static HTML).
{
  const site = "books.toscrape.com";
  teach.push({ site, url: "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html" });
  const list = await get("https://books.toscrape.com/catalogue/page-2.html");
  const urls = [...new Set([...list.matchAll(/<h3><a href="([^"]+)"/g)].map((m) => new URL(m[1]!, "https://books.toscrape.com/catalogue/").href))].slice(0, 10);
  for (const [i, url] of urls.entries()) {
    const html = await get(url);
    const price = one(/<th>Price \(incl\. tax\)<\/th>\s*<td>£([\d.]+)<\/td>/, html, `price ${url}`);
    const stock = one(/In stock \((\d+) available\)/, html, `stock ${url}`);
    const upc = one(/<th>UPC<\/th>\s*<td>([^<]+)<\/td>/, html, `upc ${url}`);
    const q = i % 3;
    if (q === 0) add(site, "rv-bts", i, url, "What is the price of this book, including tax, in GBP?", { type: "number", value: Number(price) });
    if (q === 1) add(site, "rv-bts", i, url, "How many copies of this book are in stock?", { type: "number", value: Number(stock) });
    if (q === 2) add(site, "rv-bts", i, url, "What is this book's UPC?", { type: "includes", value: upc });
  }
}

// 2. quotes.toscrape.com: author pages (static HTML).
{
  const site = "quotes.toscrape.com";
  teach.push({ site, url: "https://quotes.toscrape.com/author/Albert-Einstein/" });
  const authors = new Set<string>();
  for (let page = 1; authors.size < 11 && page <= 5; page++) {
    const html = await get(`https://quotes.toscrape.com/page/${page}/`);
    for (const m of html.matchAll(/href="(\/author\/[^"]+)"/g)) authors.add(new URL(m[1]!, "https://quotes.toscrape.com").href);
  }
  const urls = [...authors].filter((u) => !u.includes("Albert-Einstein")).slice(0, 10);
  for (const [i, url] of urls.entries()) {
    const html = await get(url);
    const born = one(/<span class="author-born-date">([^<]+)<\/span>/, html, `born ${url}`);
    const place = one(/<span class="author-born-location">in ([^<]+)<\/span>/, html, `place ${url}`);
    const date = new Date(`${born} UTC`);
    if (Number.isNaN(date.getTime())) throw new Error(`bad date ${born}`);
    if (i % 2 === 0) add(site, "rv-qts", i, url, "On what date was this author born?", { type: "date", value: date.toISOString().slice(0, 10), toleranceDays: 0 });
    // The first part of the place (usually the city) is enough.
    else add(site, "rv-qts", i, url, "Where was this author born?", { type: "includes", value: place.split(",")[0]!.trim() });
  }
}

// 3. hex.pm: package version pages (server-rendered; answers from hex.pm's API).
{
  const site = "hex.pm";
  teach.push({ site, url: "https://hex.pm/packages/plug/1.14.0" });
  const pkgs = [
    ["phoenix_html", "3.3.0"], ["ecto_sql", "3.10.0"], ["telemetry", "1.2.1"], ["decimal", "2.1.1"], ["mime", "2.0.3"],
    ["plug_cowboy", "2.6.1"], ["postgrex", "0.17.1"], ["castore", "1.0.3"], ["tesla", "1.7.0"], ["absinthe", "1.7.1"],
  ];
  for (const [i, [name, version]] of pkgs.entries()) {
    const rel = await json<{ inserted_at: string; publisher: { username: string } | null }>(`https://hex.pm/api/packages/${name}/releases/${version}`);
    const pkg = await json<{ meta: { licenses: string[] } }>(`https://hex.pm/api/packages/${name}`);
    const url = `https://hex.pm/packages/${name}/${version}`;
    const q = i % 3;
    if (q === 0 || !rel.publisher) add(site, "rv-hex", i, url, "On what date was this version published?", { type: "date", value: day(rel.inserted_at) });
    else if (q === 1) add(site, "rv-hex", i, url, "Which user published this version?", { type: "includes", value: rel.publisher.username });
    else add(site, "rv-hex", i, url, "What license is this package under?", { type: "includes", value: pkg.meta.licenses[0]! });
    await sleep(300);
  }
}

// 4. crates.io: crate version pages (a JavaScript app that loads JSON; answers from the same API).
{
  const site = "crates.io";
  teach.push({ site, url: "https://crates.io/crates/serde/1.0.190" });
  const crates = [
    ["tokio", "1.32.0"], ["rand", "0.8.5"], ["regex", "1.9.6"], ["anyhow", "1.0.75"], ["clap", "4.4.6"],
    ["syn", "2.0.38"], ["log", "0.4.20"], ["itoa", "1.0.9"], ["bytes", "1.5.0"], ["thiserror", "1.0.49"],
  ];
  for (const [i, [name, version]] of crates.entries()) {
    const { version: v } = await json<{ version: { license: string; rust_version: string | null; created_at: string } }>(
      `https://crates.io/api/v1/crates/${name}/${version}`,
    );
    const url = `https://crates.io/crates/${name}/${version}`;
    const q = i % 3;
    if (q === 0) add(site, "rv-crates", i, url, "What license is this crate version published under?", { type: "includes", value: v.license });
    else if (q === 1 && v.rust_version) add(site, "rv-crates", i, url, "What minimum Rust version (MSRV) does this crate version declare?", { type: "includes", value: v.rust_version });
    else add(site, "rv-crates", i, url, "On what date was this crate version published?", { type: "date", value: day(v.created_at) });
    await sleep(1100); // crates.io asks for at most one request per second
  }
}

// 5. arxiv.org: abstract pages of fixed versions (answers from the arXiv API).
{
  const site = "arxiv.org";
  teach.push({ site, url: "https://arxiv.org/abs/1706.03762v1" });
  const ids = ["1810.04805v1", "2005.14165v1", "1512.03385v1", "1409.0473v1", "1412.6980v1", "2010.11929v1", "1312.6114v1", "1406.2661v1", "2112.10752v1", "1910.10683v1"];
  const feed = await get(`https://export.arxiv.org/api/query?id_list=${ids.join(",")}&max_results=20`);
  const entries = feed.split("<entry>").slice(1);
  for (const [i, id] of ids.entries()) {
    const e = entries.find((x) => x.includes(`/abs/${id}`));
    if (!e) throw new Error(`arXiv entry ${id} missing`);
    const published = one(/<published>([^<]+)<\/published>/, e, `published ${id}`);
    const firstAuthor = one(/<author>\s*<name>([^<]+)<\/name>/, e, `author ${id}`);
    const primary = one(/<arxiv:primary_category[^>]*term="([^"]+)"/, e, `primary ${id}`);
    const url = `https://arxiv.org/abs/${id}`;
    const q = i % 3;
    if (q === 0) add(site, "rv-arxiv", i, url, "On what date was this version of the paper submitted?", { type: "date", value: day(published) });
    // Last name of the first author.
    else if (q === 1) add(site, "rv-arxiv", i, url, "Who is the first author of this paper?", { type: "includes", value: firstAuthor.split(" ").at(-1)! });
    else add(site, "rv-arxiv", i, url, "What is this paper's primary arXiv subject category (e.g. cs.LG)?", { type: "includes", value: primary });
  }
}

// 6. news.ycombinator.com: old story pages, frozen (answers from the HN API).
{
  const site = "news.ycombinator.com";
  teach.push({ site, url: "https://news.ycombinator.com/item?id=8863" });
  const candidates = [1, 121003, 2921983, 3078128, 4247615, 5014343, 7097225, 9224, 1078, 363, 15, 17, 20, 25, 101, 13, 2, 3, 4, 5, 6, 7, 30, 40, 50];
  let i = 0;
  for (const id of candidates) {
    if (i >= 10) break;
    const it = await json<{ type: string; by?: string; score?: number; descendants?: number; title?: string; dead?: boolean; deleted?: boolean } | null>(
      `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
    );
    if (!it || it.type !== "story" || it.dead || it.deleted || !it.by || !it.title) continue;
    const url = `https://news.ycombinator.com/item?id=${id}`;
    // Skip questions whose answer would be weak to check: a zero ("no comments") (user names are checked as written).
    const q = i % 3;
    if (q === 1 && it.by.length >= 2) add(site, "rv-hn", i, url, "Which user submitted this story?", { type: "includes", value: it.by });
    else if (q === 2 && (it.descendants ?? 0) > 0) add(site, "rv-hn", i, url, "How many comments does this story have?", { type: "number", value: it.descendants! });
    else add(site, "rv-hn", i, url, "How many points does this story have?", { type: "number", value: it.score! });
    i++;
  }
  if (i < 10) throw new Error(`only ${i} HN stories found`);
}

const out = {
  version: 1,
  verified: new Date().toISOString().slice(0, 10),
  notes:
    "Repeat-visit track: ten pages of one type per site, all of the same type as the site's teach page (which the teacher maps and the agent never sees). " +
    "Answers were read by bench/scripts/make-repeat-tasks.ts from each site's HTML or public API on the date above. " +
    "Hacker News points and comment counts on old stories are frozen in practice, but can still change if a comment is deleted.",
  teach,
  tasks,
};
fs.writeFileSync("bench/tasks-repeat.json", JSON.stringify(out, null, 2) + "\n");
console.log(`${tasks.length} tasks on ${teach.length} sites`);
