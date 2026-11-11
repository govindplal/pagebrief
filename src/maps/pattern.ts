// Page-type keys: a site plus a URL path pattern. Two product pages on one
// site share a key; a product page and a search page do not.

/** Hostname without "www.", lowercased. */
export function hostKey(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
}

/** Path segments; a trailing slash does not count, so /a/b/ and /a/b are the same page. */
const segments = (path: string): string[] => {
  const s = path.split("/").slice(1);
  if (s.length && s[s.length - 1] === "") s.pop();
  return s;
};

const decode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Does `pattern` ("*" one segment, "**" the rest) match the URL's path? Query and hash are ignored. */
export function matchPattern(pattern: string, url: string): boolean {
  let path: string;
  try {
    path = new URL(url, "https://x.invalid").pathname;
  } catch {
    return false;
  }
  const want = segments(pattern);
  const have = segments(path);
  for (let i = 0; i < want.length; i++) {
    const w = want[i]!;
    if (w === "**") return true;
    if (i >= have.length) return false;
    if (w !== "*" && w.toLowerCase() !== decode(have[i]!).toLowerCase()) return false;
  }
  return want.length === have.length;
}

/** How specific a pattern is: literal segments count most, so /a/b beats /a/* beats /**. */
export function specificity(pattern: string): number {
  return segments(pattern).reduce((n, s) => n + (s === "**" ? 0 : s === "*" ? 1 : 3), 0);
}

/**
 * A first guess at the page type's pattern, which the teacher may generalize:
 * segments that look like ids, slugs or versions become "*".
 */
export function proposePattern(url: string): string {
  const segs = segments(new URL(url).pathname);
  const out: string[] = [];
  segs.forEach((s, i) => {
    const file = /^[\w-]+\.(html?|php|aspx?)$/i.test(s);
    const word = /^[a-z][a-z-]{0,14}$/i.test(s);
    // The first segment names the section (/catalogue, /project); later ones are
    // usually the item, except files (index.html) and a word right after an
    // item (/gems/*/versions/*).
    if (i === 0 || file) out.push(/\d/.test(s) && !file ? "*" : s);
    else if (word && i < segs.length - 1 && out[i - 1] === "*") out.push(s);
    else out.push("*");
  });
  return "/" + out.join("/");
}
