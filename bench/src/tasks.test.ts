import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTasks } from "./tasks.ts";

test("tasks.json parses and covers 20 sites with at least 3 tasks each", () => {
  const tasks = loadTasks();
  const perSite = new Map<string, number>();
  for (const t of tasks) perSite.set(t.site, (perSite.get(t.site) ?? 0) + 1);
  assert.equal(perSite.size, 20, `sites: ${[...perSite.keys()].join(", ")}`);
  for (const [site, n] of perSite) assert.ok(n >= 3, `${site} has only ${n} tasks`);
});
