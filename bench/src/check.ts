// Answer-key checkers. Lenient on format (dates, thousands separators, case),
// strict on content. Numeric expected values match standalone numbers only, so
// "4" does not match inside "2024".

export type Check =
  | { type: "includes"; value: string }
  | { type: "anyOf"; values: string[] }
  | { type: "number"; value: number; tolerance?: number }
  | { type: "date"; value: string; toleranceDays?: number }
  | { type: "digits"; value: string }
  | { type: "all"; of: Check[] };

const NUMERIC = /^\d[\d,]*(\.\d+)?$/;
const DAY_MS = 86_400_000;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = "(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";

export function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Standalone numbers in text: "10,472" -> 10472, "1311.99" -> 1311.99. No signs (dates would go negative). */
export function numbersIn(s: string): number[] {
  return [...s.matchAll(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, "")));
}

/** Calendar dates in text, as UTC-midnight epoch ms. */
export function datesIn(s: string): number[] {
  const t = normalize(s);
  const out: number[] = [];
  const push = (y: number, m: number, d: number) => {
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) out.push(Date.UTC(y, m - 1, d));
  };
  const month = (name: string) => MONTHS.indexOf(name.slice(0, 3)) + 1;
  for (const m of t.matchAll(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/g)) push(+m[1]!, +m[2]!, +m[3]!);
  for (const m of t.matchAll(/(?<!\d)(\d{1,2})\/(\d{1,2})\/(\d{4})/g)) push(+m[3]!, +m[1]!, +m[2]!); // US m/d/yyyy
  for (const m of t.matchAll(new RegExp(`${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})`, "g"))) push(+m[3]!, month(m[1]!), +m[2]!);
  for (const m of t.matchAll(new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE},?\\s+(\\d{4})`, "g"))) push(+m[3]!, month(m[2]!), +m[1]!);
  return out;
}

export function check(answer: string, c: Check): boolean {
  switch (c.type) {
    case "includes":
      if (NUMERIC.test(c.value)) return check(answer, { type: "number", value: Number(c.value.replace(/,/g, "")) });
      return normalize(answer).includes(normalize(c.value));
    case "anyOf":
      return c.values.some((v) => check(answer, { type: "includes", value: v }));
    case "number": {
      const tol = c.tolerance ?? 1e-9;
      return numbersIn(answer).some((n) => Math.abs(n - c.value) <= tol);
    }
    case "date": {
      const [y, m, d] = c.value.split("-").map(Number);
      const want = Date.UTC(y!, m! - 1, d!);
      const tol = (c.toleranceDays ?? 1) * DAY_MS; // pages render in local time zones
      return datesIn(answer).some((t) => Math.abs(t - want) <= tol);
    }
    case "digits":
      return answer.replace(/\D/g, "").includes(c.value.replace(/\D/g, ""));
    case "all":
      return c.of.every((sub) => check(answer, sub));
  }
}

/** The text after the last "ANSWER:" line (markdown bold tolerated), or null if the agent never wrote one. */
export function extractAnswer(result: string): string | null {
  const matches = [...result.matchAll(/^[\s>*_-]*answer\**\s*:\s*\**\s*(.+)$/gim)];
  const last = matches.at(-1)?.[1]?.trim();
  return last ? last.replace(/\*+$/, "").trim() : null;
}
