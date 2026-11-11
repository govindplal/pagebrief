// Measures what dropping invisible text removes on the benchmark's pages: for
// each start URL, the characters and elements dropped, a sample of the dropped
// text, and whether the task's answer is still in the page text.
//   npx tsx bench/scripts/hidden-text.ts > docs/results/<date>-hidden-text.md
import { Browser } from "../../src/browser.ts";
import { check } from "../src/check.ts";
import { loadTasks } from "../src/tasks.ts";

const tasks = [...loadTasks("bench/tasks.json"), ...loadTasks("bench/tasks-repeat.json")];
const urls = [...new Set(tasks.map((t) => t.url))];
const keep = await Browser.launch({ dropHidden: false });
const drop = await Browser.launch({ dropHidden: true });
const rows: string[] = [];
let totalChars = 0;
let totalDropped = 0;
let lost = 0;
try {
  for (const url of urls) {
    try {
      const [a, b] = [await keep.open(url), await drop.open(url)];
      const s = b.signals!;
      totalChars += a.text.length;
      totalDropped += s.hiddenChars;
      // A task whose answer check passes on the full text but not on the dropped text lost its answer.
      const lostHere = tasks.filter((t) => t.url === url && check(a.text, t.check) && !check(b.text, t.check)).map((t) => t.id);
      lost += lostHere.length;
      if (s.hiddenElements || lostHere.length)
        rows.push(`| ${url} | ${s.hiddenElements} | ${s.hiddenChars.toLocaleString("en-US")} | ${(s.hiddenSamples ?? []).map((x) => `"${x.replace(/\|/g, "/")}"`).join("; ")} | ${lostHere.join(", ") || "-"} |`);
    } catch (err) {
      rows.push(`| ${url} | error | | ${err instanceof Error ? err.message.slice(0, 80) : err} | |`);
    }
  }
} finally {
  await keep.close();
  await drop.close();
}
console.log(`## What dropping invisible text removes\n`);
console.log(`${urls.length} start URLs from bench/tasks.json and bench/tasks-repeat.json, ${new Date().toISOString().slice(0, 10)}.`);
console.log(`Dropped ${totalDropped.toLocaleString("en-US")} of ${totalChars.toLocaleString("en-US")} characters (${((100 * totalDropped) / Math.max(1, totalChars)).toFixed(2)}%) on ${rows.length} pages. Tasks whose answer was in the full text but not after the drop: ${lost}.\n`);
console.log("| URL | Elements dropped | Chars dropped | Sample of dropped text | Tasks that lost their answer |");
console.log("|---|---|---|---|---|");
console.log(rows.join("\n"));
