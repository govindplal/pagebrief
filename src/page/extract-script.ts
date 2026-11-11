// Runs inside the page (Runtime.evaluate) and returns raw facts about it.
// Kept as a plain JS string so no transpiler helpers leak into the page.
// innerText only includes rendered text, so display:none / visibility:hidden
// content (a common prompt-injection hiding place) never reaches the agent.
//
// With dropHidden, text that is rendered but not visible is dropped too:
// elements at zero opacity, with a zero font size, or positioned far off the
// screen. Screen-reader text (the "visually hidden" pattern: a 1px box that is
// clipped) is kept, because it is real content. The elements are hidden for
// the moment innerText is read and then restored, so the page is unchanged.
export interface ExtractOptions {
  dropHidden?: boolean;
}

export const extractScript = (opts: ExtractOptions = {}): string => String.raw`(() => {
  const DROP_HIDDEN = ${opts.dropHidden ? "true" : "false"};
  const clean = (s, n) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const visible = (el) => !!(el.offsetParent || el.getClientRects().length);
  const body = document.body;

  // Rendered but invisible text: hide it while the text is read.
  const hidden = [];
  let hiddenChars = 0;
  if (DROP_HIDDEN && body) {
    const vw = Math.max(document.documentElement.clientWidth, innerWidth || 0);
    const docH = Math.max(document.documentElement.scrollHeight, body.scrollHeight);
    const all = body.getElementsByTagName("*");
    const n = Math.min(all.length, 30000);
    for (let i = 0; i < n; i++) {
      const el = all[i];
      if (el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.tagName === "NOSCRIPT") continue;
      if (hidden.length && hidden[hidden.length - 1].contains(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none") continue;
      let drop = cs.opacity === "0" || parseFloat(cs.fontSize) === 0;
      if (!drop && (cs.position === "absolute" || cs.position === "fixed")) {
        const r = el.getBoundingClientRect();
        const off = r.right < -50 || r.bottom + scrollY < -50 || r.left > vw + 50 || r.top + scrollY > docH + 50;
        // Screen-reader text: a tiny box (often clipped). Keep it.
        const srOnly = r.width <= 2 && r.height <= 2;
        drop = off && !srOnly;
      }
      if (!drop) continue;
      const t = (el.textContent || "").trim();
      if (!t) continue;
      hidden.push(el);
      hiddenChars += t.length;
    }
  }
  const restore = hidden.map((el) => {
    const v = el.style.getPropertyValue("display");
    const p = el.style.getPropertyPriority("display");
    el.style.setProperty("display", "none", "important");
    return () => (v ? el.style.setProperty("display", v, p) : el.style.removeProperty("display"));
  });

  try {
    const text = body
      ? body.innerText.replace(/[ \t ]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 400000)
      : "";
    // Where the page's main content starts in the text, so open() can skip the
    // site header and navigation that come before it.
    let mainStart = 0;
    const mainEl = document.querySelector('main, [role="main"]') || document.querySelector("article");
    if (mainEl && text) {
      const probe = (mainEl.innerText || "").replace(/[ \t ]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 60);
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
    const metaTags = {};
    for (const m of document.querySelectorAll("meta[name][content], meta[property][content]")) {
      const k = m.getAttribute("name") || m.getAttribute("property");
      if (Object.keys(metaTags).length < 60 && k && !(k in metaTags)) metaTags[k] = clean(m.content, 300);
    }
    // Signs of a bot check: the challenge widgets the big vendors use.
    const challenge = !!document.querySelector(
      'iframe[src*="challenges.cloudflare.com"], iframe[src*="hcaptcha.com"], iframe[src*="recaptcha"], iframe[src*="captcha-delivery.com"], #px-captcha, #challenge-form, #challenge-running, #cf-challenge-running, .cf-turnstile, [data-sitekey]'
    );
    const hasPassword = !!document.querySelector('input[type="password"]');
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
      meta: metaTags,
      signals: { challenge, hasPassword, hiddenChars, hiddenElements: hidden.length },
    };
  } finally {
    for (const r of restore) r();
  }
})()`;

/** The default script: invisible text dropped. */
export const EXTRACT_SCRIPT = extractScript({ dropHidden: true });
