// Chooses which captured JSON responses to keep. A page can load dozens of
// JSON responses and most of the early ones are analytics and consent calls;
// keeping the first N by arrival would crowd out the page's own data.
import type { CapturedJson } from "./view.ts";

const TRACKER =
  /analytics|telemetry|tracking|beacon|collect\b|sentry|segment\.|googletagmanager|google-analytics|doubleclick|hotjar|datadog|newrelic|nr-data|clarity\.ms|amplitude|mixpanel|optimizely|consent|cookielaw|onetrust|intercom|fullstory|bugsnag|logrocket/i;

/** Last two labels of a hostname: a cheap same-site test with no public-suffix list. */
const site = (host: string): string => host.split(".").slice(-2).join(".");

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

/** 0 = the page's own site, 1 = another site, 2 = looks like analytics or consent. */
export function jsonTier(url: string, pageUrl: string): 0 | 1 | 2 {
  if (TRACKER.test(url)) return 2;
  const host = hostOf(url);
  return host && site(host) === site(hostOf(pageUrl)) ? 0 : 1;
}

/** Own-site data first, analytics last, arrival order kept within each group. */
export function rankJson(captured: CapturedJson[], pageUrl: string, keep: number): CapturedJson[] {
  return captured
    .map((j, i) => ({ j, i, tier: jsonTier(j.url, pageUrl) }))
    .sort((a, b) => a.tier - b.tier || a.i - b.i)
    .slice(0, keep)
    .map((x) => x.j);
}
