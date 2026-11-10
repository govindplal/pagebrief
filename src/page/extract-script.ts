// Runs inside the page (Runtime.evaluate) and returns raw facts about it.
// Kept as a plain JS string so no transpiler helpers leak into the page.
// innerText only includes rendered text, so display:none / visibility:hidden
// content (a common prompt-injection hiding place) never reaches the agent.
export const EXTRACT_SCRIPT = String.raw`(() => {
  const clean = (s, n) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const visible = (el) => !!(el.offsetParent || el.getClientRects().length);
  const body = document.body;
  const text = body
    ? body.innerText.replace(/[ \t ]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 400000)
    : "";
  // Where the page's main content starts in the text, so open() can skip the
  // site header and navigation that come before it.
  let mainStart = 0;
  const mainEl = document.querySelector('main, [role="main"]') || document.querySelector("article");
  if (mainEl && text) {
    const probe = (mainEl.innerText || "").replace(/[ \t ]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 60);
    if (probe.length >= 20) mainStart = Math.max(0, text.indexOf(probe));
  }
  const headings = [...document.querySelectorAll("h1,h2,h3")]
    .filter(visible)
    .slice(0, 80)
    .map((h) => ({ level: Number(h.tagName[1]), text: clean(h.innerText, 120) }))
    .filter((h) => h.text);
  const seen = new Set();
  const links = [];
  for (const a of document.querySelectorAll("a[href]")) {
    if (links.length >= 500) break;
    const href = a.href;
    if (!/^https?:/.test(href) || seen.has(href)) continue;
    const t = clean(a.innerText || a.getAttribute("aria-label") || a.title, 100);
    if (!t || !visible(a)) continue;
    seen.add(href);
    links.push({ text: t, href });
  }
  const labelOf = (el) => {
    const byFor = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null;
    const wrap = el.closest("label");
    return clean((byFor && byFor.innerText) || el.getAttribute("aria-label") || el.placeholder || (wrap && wrap.innerText) || "", 60);
  };
  const skip = ["hidden", "submit", "button", "image", "reset", "fieldset"];
  const forms = [...document.forms].slice(0, 8).map((f) => ({
    action: f.action,
    method: (f.getAttribute("method") || "get").toLowerCase(),
    fields: [...f.elements]
      .filter((e) => e.name && !skip.includes(e.type))
      .slice(0, 12)
      .map((e) => ({
        name: e.name,
        type: e.type || e.tagName.toLowerCase(),
        label: labelOf(e),
        options: e.tagName === "SELECT" ? [...e.options].slice(0, 15).map((o) => clean(o.text, 40)) : undefined,
      })),
  })).filter((f) => f.fields.length);
  const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0, 10).map((s) => s.textContent || "");
  const meta = (n) => {
    const m = document.querySelector('meta[name="' + n + '"], meta[property="' + n + '"]');
    return m ? clean(m.content, 300) : "";
  };
  return {
    url: location.href,
    title: clean(document.title, 200),
    description: meta("description") || meta("og:description"),
    lang: document.documentElement.lang || "",
    text,
    mainStart,
    headings,
    links,
    forms,
    jsonLd,
  };
})()`;
