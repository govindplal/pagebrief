// Keeps the agent out of the user's own network. A web page (or a prompt
// injection inside one) can ask an agent to open http://localhost:8080/admin
// or a cloud metadata address; open() refuses those unless explicitly allowed.
import dns from "node:dns/promises";
import net from "node:net";

function isPrivateV4(ip: string): boolean {
  const [a = 0, b = 0, c = 0] = ip.split(".").map(Number);
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking range
    a >= 224 // multicast and reserved
  );
}

/** True for loopback, private, link-local and other non-public addresses. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").replace(/%.*$/, "").toLowerCase();
  if (net.isIPv4(ip)) return isPrivateV4(ip);
  if (!net.isIPv6(ip)) return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return isPrivateV4(mapped[1]!);
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1]!, 16);
    const lo = parseInt(mappedHex[2]!, 16);
    return isPrivateV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return (
    ip === "::" ||
    ip === "::1" ||
    /^f[cd]/.test(ip) || // unique local fc00::/7
    /^fe[89ab]/.test(ip) || // link-local fe80::/10
    /^ff/.test(ip) // multicast
  );
}

/** True when Chrome will pick up a proxy from the environment, as it does on Linux and macOS. */
export function usesProxyEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "https_proxy", "http_proxy", "all_proxy"].some((k) => !!env[k]);
}

export type Lookup = (host: string) => Promise<{ address: string }[]>;

const systemLookup: Lookup = (host) => dns.lookup(host, { all: true });

export const PRIVATE_HINT =
  "pass --allow-private (or set AGENTIC_BROWSER_ALLOW_PRIVATE=1) to open local and private-network pages, or if you browse through a proxy on a private address";

/**
 * Throws when a URL points at this machine or a private network. The URL
 * parser has already normalised numeric forms (http://2130706433 is 127.0.0.1).
 * A name that does not resolve is left for Chrome to report.
 */
export async function assertPublicUrl(url: string, lookup: Lookup = systemLookup): Promise<void> {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  const refuse = (why: string) => new Error(`refused to open ${url}: ${why}; ${PRIVATE_HINT}`);
  if (host === "localhost" || host.endsWith(".localhost")) throw refuse("it is this machine");
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw refuse(`${host} is a local or private address`);
    return;
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host);
  } catch {
    return;
  }
  const bad = addresses.find((a) => isPrivateAddress(a.address));
  if (bad) throw refuse(`${host} resolves to ${bad.address}, a local or private address`);
}
