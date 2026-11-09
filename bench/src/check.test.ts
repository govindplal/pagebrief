import assert from "node:assert/strict";
import { test } from "node:test";
import { check, datesIn, extractAnswer, numbersIn } from "./check.ts";

test("numbersIn handles thousands separators, decimals and lists", () => {
  assert.deepEqual(numbersIn("population 10,472 and area 26.0"), [10472, 26]);
  assert.deepEqual(numbersIn("2818, 7230,7231"), [2818, 7230, 7231]);
  assert.deepEqual(numbersIn("£1,311.99"), [1311.99]);
});

test("numeric includes matches standalone numbers only", () => {
  assert.equal(check("It won 4 awards", { type: "includes", value: "4" }), true);
  assert.equal(check("Released in 2024", { type: "includes", value: "4" }), false);
  assert.equal(check("4,395 people", { type: "number", value: 4395 }), true);
});

test("text includes is case- and whitespace-insensitive", () => {
  assert.equal(check("Title:  A Year in   Provence", { type: "includes", value: "a year in provence" }), true);
  assert.equal(check("It’s Only the Himalayas", { type: "includes", value: "It's Only" }), true);
});

test("datesIn parses ISO, US, month-name and day-month formats", () => {
  const want = Date.UTC(2022, 8, 28);
  for (const s of ["2022-09-28", "9/28/2022", "Sep 28, 2022", "September 28th, 2022", "28 Sept 2022"]) {
    assert.ok(datesIn(s).includes(want), s);
  }
});

test("date check allows one day for time zones by default", () => {
  assert.equal(check("published Mar 23, 2021", { type: "date", value: "2021-03-22" }), true);
  assert.equal(check("published Mar 25, 2021", { type: "date", value: "2021-03-22" }), false);
  assert.equal(check("published Mar 23, 2021", { type: "date", value: "2021-03-22", toleranceDays: 0 }), false);
});

test("all, anyOf and digits compose", () => {
  const c = {
    type: "all" as const,
    of: [
      { type: "anyOf" as const, values: ["apache-2.0", "Apache 2.0"] },
      { type: "digits" as const, value: "978-0-14-032872-1" },
    ],
  };
  assert.equal(check("Apache 2.0; ISBN 9780140328721", c), true);
  assert.equal(check("MIT; ISBN 9780140328721", c), false);
});

test("extractAnswer takes the last ANSWER line and strips markdown", () => {
  assert.equal(extractAnswer("thinking...\nANSWER: 12"), "12");
  assert.equal(extractAnswer("**ANSWER:** Argo, Life of Pi (4)"), "Argo, Life of Pi (4)");
  assert.equal(extractAnswer("ANSWER: first\nmore\nAnswer: second"), "second");
  assert.equal(extractAnswer("no final line here"), null);
});
