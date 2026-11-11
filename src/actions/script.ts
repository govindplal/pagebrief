// In-page code for actions. The same enumeration runs when a page is read (to
// list what can be done) and again when an action is performed (to find the
// element by position), so both see the elements in the same order.
import type { ActionInfo } from "./risk.ts";

/** One actionable element as the page listing reports it. */
export interface ActionItem extends ActionInfo {
  /** Position in the page's actionable elements. */
  index: number;
  options?: string[];
}

/** Defines pbList(): [{ el, info }] for every visible, enabled, actionable element. */
export const ENUMERATE_JS = String.raw`
const pbClean = (s, n) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
const pbList = () => {
  const vis = (el) => !!(el.offsetParent || el.getClientRects().length) && getComputedStyle(el).visibility !== "hidden";
  const out = [];
  const sel = 'a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"]';
  for (const el of document.querySelectorAll(sel)) {
    if (out.length >= 300) break;
    if (el.disabled || !vis(el)) continue;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (tag === "input" && type === "hidden") continue;
    let kind;
    if (tag === "a") kind = "link";
    else if (tag === "select") kind = "select";
    else if (tag === "textarea") kind = "text";
    else if (tag === "input") kind = ["submit", "button", "image", "reset"].includes(type) ? "button" : ["checkbox", "radio", "password", "file"].includes(type) ? type : "text";
    else kind = el.getAttribute("role") === "link" ? "link" : "button";
    const field = ["text", "select", "checkbox", "radio", "password", "file"].includes(kind);
    const label = field && el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null;
    const wrap = field ? el.closest("label") : null;
    const text = pbClean(
      field
        ? (label && label.innerText) || el.getAttribute("aria-label") || el.placeholder || (wrap && wrap.innerText) || el.title || el.name
        : el.innerText || el.getAttribute("aria-label") || el.value || el.title || el.alt,
      60,
    );
    const form = el.form ? { method: (el.form.getAttribute("method") || "get").toLowerCase(), action: pbClean(el.form.action, 120) } : null;
    const submits = kind === "button" && !!form && (type === "submit" || (tag === "button" && type === "") || (tag === "input" && type === "image"));
    const info = {
      index: out.length,
      kind,
      text,
      href: tag === "a" ? el.href : undefined,
      name: el.name || "",
      form,
      submits,
      options: tag === "select" ? [...el.options].slice(0, 12).map((o) => pbClean(o.text, 30)) : undefined,
    };
    out.push({ el, info });
  }
  return out;
};
`;

/** The expression that returns the page's action listing (used by the extract script). */
export const LIST_ACTIONS_JS = `(() => { ${ENUMERATE_JS} return pbList().map((x) => x.info); })()`;

export interface Op {
  index: number;
  /** kind|text of the element when it was listed; the action is refused if the page changed under it. */
  signature: string;
  value?: string;
  submit?: boolean;
}

/** A script that performs one action and returns { ok, error? }. */
export function performScript(op: Op): string {
  return `(() => { ${ENUMERATE_JS}
    const op = ${JSON.stringify(op)};
    const found = pbList()[op.index];
    if (!found) return { ok: false, error: "that element is no longer on the page; call open(url) again to list the actions" };
    const { el, info } = found;
    if (info.kind + "|" + info.text !== op.signature) return { ok: false, error: "the page changed since the actions were listed (element " + op.index + " is now " + info.kind + ' "' + info.text + '"); call open(url) again' };
    const setValue = (v) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    el.scrollIntoView({ block: "center" });
    if (info.kind === "text") {
      if (op.value === undefined) return { ok: false, error: "this field needs a value" };
      el.focus();
      setValue(op.value);
      if (op.submit) {
        if (!el.form) return { ok: false, error: "this field is not in a form, so there is nothing to submit" };
        el.form.requestSubmit();
      }
    } else if (info.kind === "select") {
      if (op.value === undefined) return { ok: false, error: "choose an option: " + (info.options || []).join(" | ") };
      const want = op.value.trim().toLowerCase();
      const opt = [...el.options].find((o) => o.text.trim().toLowerCase() === want || o.value.toLowerCase() === want) ||
        [...el.options].find((o) => o.text.trim().toLowerCase().includes(want));
      if (!opt) return { ok: false, error: "no option matches " + JSON.stringify(op.value) + "; options: " + (info.options || []).join(" | ") };
      el.value = opt.value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      if (op.submit) {
        if (!el.form) return { ok: false, error: "this field is not in a form, so there is nothing to submit" };
        el.form.requestSubmit();
      }
    } else {
      el.click();
    }
    return { ok: true };
  })()`;
}
