import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class SsrfBlockedError extends Error {}

function ipv4Number(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
    n = n * 256 + Number(part);
  }
  return n >>> 0;
}

/** [network, prefix length] — every IPv4 range a server must never be talked into reaching. */
const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT — also where Tailscale and friends live
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, including the cloud metadata address
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, and broadcast
];

function isBlockedIPv4(ip: string): boolean {
  const n = ipv4Number(ip);
  if (n === null) return true; // fail closed on anything unparseable
  return BLOCKED_V4.some(([network, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((n & mask) >>> 0) === ((ipv4Number(network)! & mask) >>> 0);
  });
}

/** The 8 hextets of an IPv6 address, or null when it is not one. */
function ipv6Hextets(ip: string): number[] | null {
  let address = ip.toLowerCase().split("%")[0]!;
  // A trailing dotted IPv4 part becomes its two hextets.
  const v4 = address.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = ipv4Number(v4[1]!);
    if (n === null) return null;
    address = `${address.slice(0, -v4[1]!.length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const parts = [...head, ...Array(fill).fill("0"), ...tail];
  if (parts.length !== 8 || parts.some((p) => !/^[0-9a-f]{1,4}$/.test(p))) return null;
  return parts.map((p) => parseInt(p, 16));
}

function isBlockedIPv6(ip: string): boolean {
  const h = ipv6Hextets(ip);
  if (!h) return true; // fail closed
  const embeddedV4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  if (h.every((x) => x === 0)) return true; // unspecified ::
  if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return true; // loopback ::1
  // An IPv4 address carried inside an IPv6 one is judged as the IPv4 it
  // reaches: mapped (::ffff:a.b.c.d), compatible (::a.b.c.d), NAT64
  // (64:ff9b::a.b.c.d) and 6to4 (2002:aabb:ccdd::).
  if (h.slice(0, 5).every((x) => x === 0) && (h[5] === 0xffff || h[5] === 0)) return isBlockedIPv4(embeddedV4(h[6]!, h[7]!));
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) return isBlockedIPv4(embeddedV4(h[6]!, h[7]!));
  if (h[0] === 0x2002) return isBlockedIPv4(embeddedV4(h[1]!, h[2]!));
  if ((h[0]! & 0xfe00) === 0xfc00) return true; // unique-local fc00::/7
  if ((h[0]! & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((h[0]! & 0xffc0) === 0xfec0) return true; // old site-local fec0::/10
  if ((h[0]! & 0xff00) === 0xff00) return true; // multicast ff00::/8
  if (h[0] === 0x2001 && h[1] === 0xdb8) return true; // documentation
  if (h[0] === 0x100 && h.slice(1, 4).every((x) => x === 0)) return true; // discard-only 100::/64
  return false;
}

/** Whether an address is one this server must never connect to on someone else's say-so. */
export function isBlockedAddress(address: string): boolean {
  return isIP(address) === 6 ? isBlockedIPv6(address) : isBlockedIPv4(address);
}

/**
 * Blocks a fetch target that resolves to a loopback/private/link-local
 * address — the standard SSRF defense for "this server fetches a URL a
 * user gave it" (here: a creator's own `actorUrl`, and every URL an
 * ActivityPub actor/outbox response points at in turn). A literal IP is
 * checked directly; a hostname is resolved via DNS and every returned
 * address is checked, since a hostname can resolve to more than one.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError("Not a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfBlockedError("Only http/https URLs are allowed.");
  }

  // `URL#hostname` keeps the brackets on an IPv6 literal (e.g. `[::1]`);
  // `net.isIP` doesn't recognize that form, so they're stripped first.
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const literalIpVersion = isIP(hostname);
  const addresses: string[] = [];
  if (literalIpVersion) {
    addresses.push(hostname);
  } else {
    // The resolver's own code (ENOTFOUND, EAI_AGAIN, ...) is kept: "no such
    // host" and "this server has no working DNS" are different problems,
    // and the second one fails every lookup with the same bare message.
    let failure = "";
    const resolved = await lookup(hostname, { all: true, verbatim: true }).catch((err: NodeJS.ErrnoException) => {
      failure = err.code ?? "lookup failed";
      return [];
    });
    for (const r of resolved) addresses.push(r.address);
    if (addresses.length === 0) {
      throw new SsrfBlockedError(`Could not resolve host ${hostname}${failure ? ` (${failure})` : ""}.`);
    }
  }

  for (const address of addresses) {
    if (isBlockedAddress(address)) throw new SsrfBlockedError("This URL resolves to a private or internal address and can't be used.");
  }
}
