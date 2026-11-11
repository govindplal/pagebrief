import fs from "node:fs";
import { z } from "zod";
import type { Check } from "./check.ts";

const CheckSchema: z.ZodType<Check> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("includes"), value: z.string().min(1) }),
    z.object({ type: z.literal("anyOf"), values: z.array(z.string().min(1)).min(1) }),
    z.object({ type: z.literal("number"), value: z.number(), tolerance: z.number().optional() }),
    z.object({ type: z.literal("date"), value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), toleranceDays: z.number().optional() }),
    z.object({ type: z.literal("digits"), value: z.string().min(1) }),
    z.object({ type: z.literal("all"), of: z.array(CheckSchema).min(1) }),
  ]),
);

const TaskSchema = z.object({
  id: z.string(),
  site: z.string(),
  url: z.url(),
  kind: z.string(),
  question: z.string(),
  check: CheckSchema,
});

const TaskFileSchema = z.object({
  version: z.number(),
  verified: z.string(),
  notes: z.string(),
  /** Repeat-visit track: one page per site for the teacher to map; never shown to the agent. */
  teach: z.array(z.object({ site: z.string(), url: z.url() })).optional(),
  tasks: z.array(TaskSchema),
});

export type Task = z.infer<typeof TaskSchema>;
export type TaskFile = z.infer<typeof TaskFileSchema>;

export function loadTaskFile(file = "bench/tasks.json"): TaskFile {
  return TaskFileSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}

export function loadTasks(file = "bench/tasks.json"): Task[] {
  const parsed = loadTaskFile(file);
  const ids = new Set<string>();
  for (const t of parsed.tasks) {
    if (ids.has(t.id)) throw new Error(`duplicate task id ${t.id}`);
    ids.add(t.id);
  }
  return parsed.tasks;
}
