// A page map: where the named facts live on one type of page (every product
// page of a shop, every version page of a registry). A large model writes it
// once; plain code checks and applies it on every later visit.
import * as z from "zod";

/** Where a field's value lives. Paths use the same syntax find() prints: a.b[0].c, items[*].name. */
export const LocationSchema = z.discriminatedUnion("from", [
  /** The page is itself a JSON document (an API URL opened directly). */
  z.object({ from: z.literal("doc"), path: z.string().min(1) }),
  /** A JSON response the page loaded; `url` is a path pattern for the response, e.g. /api/v1/crates/*. */
  z.object({ from: z.literal("json"), url: z.string().min(1), path: z.string().min(1) }),
  /** JSON-LD structured data in the page. */
  z.object({ from: z.literal("jsonld"), path: z.string().min(1) }),
  /** A <meta name|property> tag. */
  z.object({ from: z.literal("meta"), name: z.string().min(1) }),
  /** The visible text: a regex anchored on a label, with one capture group for the value. */
  z.object({ from: z.literal("text"), regex: z.string().min(1).max(300) }),
]);
export type Location = z.infer<typeof LocationSchema>;

export const FIELD_TYPES = ["string", "number", "integer", "date", "url", "boolean", "list"] as const;

export const MapFieldSchema = z.object({
  /** snake_case name an agent reads, e.g. price, release_date. */
  name: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  type: z.enum(FIELD_TYPES),
  /** Unit or currency shown after the value, e.g. GBP, stars, bytes. */
  unit: z.string().max(20).optional(),
  /** A field some pages of this type lack (e.g. a sale price). Missing is then not a failure. */
  optional: z.boolean().optional(),
  /** Value on the page the map was written from. */
  example: z.string().max(300),
  /** Optional regex the value must match, e.g. ^\d+\.\d{2}$. */
  shape: z.string().max(200).optional(),
  at: LocationSchema,
});
export type MapField = z.infer<typeof MapFieldSchema>;

export const UsageSchema = z.object({
  model: z.string(),
  costUsd: z.number().nullable(),
  tokens: z.number(),
  seconds: z.number(),
});
export type Usage = z.infer<typeof UsageSchema>;

export const PageMapSchema = z.object({
  version: z.literal(1),
  /** Hostname without www. */
  host: z.string(),
  /** Path pattern: "*" matches one segment, "**" the rest. Query strings are ignored. */
  pattern: z.string().startsWith("/"),
  /** Short label, e.g. "book page". */
  pageType: z.string().max(60),
  fields: z.array(MapFieldSchema).min(1).max(20),
  /** The page the map was written from. */
  exampleUrl: z.string(),
  createdAt: z.string(),
  /** Who wrote the current version: the teacher, or the student after a repair. */
  source: z.enum(["teacher", "student"]),
  teacher: UsageSchema.optional(),
  repairs: z.array(z.object({ at: z.string(), url: z.string(), fields: z.array(z.string()), usage: UsageSchema })).optional(),
});
export type PageMap = z.infer<typeof PageMapSchema>;

/** One field as read from a page. `ok` false means the value failed the check and is not shown. */
export interface FieldValue {
  name: string;
  type: MapField["type"];
  unit?: string;
  value?: string;
  ok: boolean;
  optional?: boolean;
  reason?: string;
}

export interface MapResult {
  map: PageMap;
  fields: FieldValue[];
  /** Every required field passed: the page can be answered from the map. */
  ok: boolean;
  /** Set when a student repaired the map on this load. */
  repaired?: string[];
}
