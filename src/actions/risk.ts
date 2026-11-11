// Risk labels for page actions. An action is read (it looks at something:
// follow a link, search, filter, sort, page), write (it changes something on a
// server: a post, a save, a cart) or dangerous (it moves money, deletes or
// closes things, signs out, or changes credentials). The labels come from the
// element's words and its form, so they are a guard and advice, not a promise.
export type Risk = "read" | "write" | "dangerous";

export const RISK_ORDER: Risk[] = ["read", "write", "dangerous"];

/** What the in-page script reports about one actionable element. */
export interface ActionInfo {
  /** link, button, text, select, checkbox, radio, password or file */
  kind: string;
  text: string;
  href?: string;
  name?: string;
  form?: { method: string; action: string } | null;
  /** A button that submits its form. */
  submits?: boolean;
}

const DANGEROUS =
  /\b(delete|remove|erase|destroy|wipe|deactivate|terminate|revoke|close (my |your |the )?account|pay|pay now|buy|buy now|purchase|place (your |my |the )?order|order now|checkout|check out|confirm (order|payment|purchase)|transfer|withdraw|donate|send money|wire|cancel (my |your |the )?(subscription|order|plan|account|membership)|unsubscribe|sign ?out|log ?out|reset password|change password|publish|go live|deploy|ban|block user)\b/i;
const DANGEROUS_HREF = /\/(log-?out|sign-?out|delete|remove|destroy|checkout|payment|purchase|unsubscribe|deactivate|close-account)(\/|\?|$|[-_])/i;
const READ_WORDS =
  /\b(search|find|filter|sort|order by|next|previous|prev|older|newer|more|show|view|expand|collapse|details|page \d+|tab|menu|first|last|back|home|read|open|download|go|apply filters?|results?)\b|^[<>«»‹›→←…]+$|^\d+$/i;
const WRITE_WORDS =
  /\b(add to (cart|bag|basket|wishlist|list)|save|submit|send|post|comment|reply|subscribe|follow|like|vote|upvote|downvote|flag|report|upload|create|update|edit|register|sign ?up|join|apply|book|reserve|accept|agree|confirm|rate|review|share|invite|log ?in|sign ?in|continue)\b/i;
const WRITE_HREF = /\/(add|cart|login|signin|signup|register|vote|like|follow|subscribe|submit|new|edit|create)(\/|\?|$|[-_])/i;

/** Why an element cannot be acted on at all, whatever the policy says. */
export function neverAllowed(a: ActionInfo): string | null {
  if (a.kind === "password") return "this server never types into password fields";
  if (a.kind === "file") return "this server never uploads files";
  return null;
}

/**
 * The risk of acting on an element. `submit` means filling a text field and then
 * submitting its form, so the form's method counts.
 */
export function classify(a: ActionInfo, submit = false): Risk {
  const text = `${a.text} ${a.name ?? ""}`;
  if (DANGEROUS.test(text)) return "dangerous";
  if (a.href && DANGEROUS_HREF.test(a.href)) return "dangerous";
  const posts = !!a.form && a.form.method.toLowerCase() !== "get";
  if (posts && a.form && DANGEROUS.test(a.form.action) && (a.submits || submit)) return "dangerous";
  switch (a.kind) {
    case "link":
      return a.href && WRITE_HREF.test(a.href) && !READ_WORDS.test(a.text) ? "write" : "read";
    case "text":
    case "select":
    case "checkbox":
    case "radio":
      // Filling or choosing changes nothing until the form is submitted.
      return submit && posts ? "write" : "read";
    default: {
      // A button: what it says, else what its form does, else assume it writes.
      if (a.submits && a.form && !posts && !WRITE_WORDS.test(a.text)) return "read";
      if (READ_WORDS.test(a.text) && !WRITE_WORDS.test(a.text) && !posts) return "read";
      if (WRITE_WORDS.test(a.text) || posts) return "write";
      return READ_WORDS.test(a.text) ? "read" : "write";
    }
  }
}

export function allowed(risk: Risk, policy: Risk): boolean {
  return RISK_ORDER.indexOf(risk) <= RISK_ORDER.indexOf(policy);
}
