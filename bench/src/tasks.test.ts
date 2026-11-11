import assert from "node:assert/strict";
import { test } from "node:test";
import { matchPattern, proposePattern } from "../../src/maps/pattern.ts";
import { loadTaskFile, loadTasks } from "./tasks.ts";

test("tasks.json parses and covers 20 sites with at least 3 tasks each", () => {
  const tasks = loadTasks();
  const perSite = new Map<string, number>();
  for (const t of tasks) perSite.set(t.site, (perSite.get(t.site) ?? 0) + 1);
  assert.equal(perSite.size, 20, `sites: ${[...perSite.keys()].join(", ")}`);
  for (const [site, n] of perSite) assert.ok(n >= 3, `${site} has only ${n} tasks`);
  assert.ok(!perSite.has("openlibrary.org"), "openlibrary.org serves a bot check to headless browsers");
});

test("the repeat-visit track has ten pages per site, of the same type as the teach page and not the teach page itself", () => {
  const f = loadTaskFile("bench/tasks-repeat.json");
  assert.equal(f.teach?.length, 6);
  for (const { site, url } of f.teach!) {
    const pages = f.tasks.filter((t) => t.site === site);
    assert.equal(pages.length, 10, site);
    for (const p of pages) {
      assert.notEqual(p.url, url);
      assert.ok(matchPattern(proposePattern(url), p.url), `${p.url} is not the same page type as ${url}`);
    }
  }
});
