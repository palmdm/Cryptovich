import { lookup } from "node:dns";
import type { LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { isBlockedAddress, SsrfBlockedError } from "./ssrf-guard.js";

/**
 * Checking a hostname and then letting `fetch` resolve it again leaves a
 * window: a hostile DNS server answers the check with a public address
 * and the connection, a moment later, with 127.0.0.1 ("DNS rebinding").
 * This agent closes it by judging the address the connection is actually
 * about to use, at the moment it is used. An IP literal never reaches a
 * lookup at all, which is why callers still run `assertPublicHttpUrl`
 * first.
 */
const pinnedLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    const done = callback as (err: NodeJS.ErrnoException | null, address: unknown, family?: number) => void;
    if (err) return done(err, []);
    if (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a.address))) {
      return done(new SsrfBlockedError(`${hostname} resolves to a private or internal address.`) as NodeJS.ErrnoException, []);
    }
    if (options.all) return done(null, addresses);
    done(null, addresses[0]!.address, addresses[0]!.family);
  });
};

const pinnedAgent = new Agent({ connect: { lookup: pinnedLookup } });

/** `fetch` that refuses to connect to an internal address, however the name resolves this time. */
export function pinnedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return undiciFetch(url, { ...(init as object), dispatcher: pinnedAgent } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
}
