import assert from "node:assert/strict";
import { test } from "node:test";
import { jsonTier, rankJson } from "./json-rank.ts";

const j = (url: string) => ({ url, status: 200, data: {} });

test("jsonTier separates own-site data, other sites and analytics", () => {
  const page = "https://www.shop.example/p/1";
  assert.equal(jsonTier("https://api.shop.example/v1/p/1", page), 0);
  assert.equal(jsonTier("https://cdn.other.net/config.json", page), 1);
  assert.equal(jsonTier("https://www.google-analytics.com/g/collect?v=2", page), 2);
  assert.equal(jsonTier("https://www.shop.example/api/telemetry", page), 2);
});

test("rankJson keeps the page's own data when analytics arrive first", () => {
  const captured = [
    j("https://o1.ingest.sentry.io/api/1/envelope/"),
    j("https://cdn.cookielaw.org/consent/x.json"),
    j("https://cdn.other.net/flags.json"),
    j("https://api.shop.example/v1/p/1"),
    j("https://api.shop.example/v1/p/1/reviews"),
  ];
  assert.deepEqual(
    rankJson(captured, "https://shop.example/p/1", 3).map((x) => x.url),
    ["https://api.shop.example/v1/p/1", "https://api.shop.example/v1/p/1/reviews", "https://cdn.other.net/flags.json"],
  );
});
