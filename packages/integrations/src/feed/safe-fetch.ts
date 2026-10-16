import { assertPublicHttpUrl } from "./ssrf-guard.js";
import { pinnedFetch } from "./pinned-fetch.js";

export class SafeFetchError extends Error {}

const MAX_REDIRECTS = 3;

/**
 * `fetch` for URLs this server was *told* to visit by someone else.
 *
 * Guarding only the URL handed in is not enough: with `redirect:
 * "follow"` the runtime silently walks a 302 to wherever it points, so a
 * host that passes the check can bounce the request straight to
 * `169.254.169.254` or a service on loopback. Every hop is therefore
 * followed manually and re-checked, which is the only point at which the
 * guard actually holds.
 *
 * Use this anywhere a remote party influences the target: an actor
 * document, an inbox named inside one, a feed URL.
 */
export async function safeFetch(
  url: string,
  init: RequestInit & {
    timeoutMs?: number;
    /**
     * Signs each hop. Per hop, not once: a signature covers the path and
     * host it was made for, so one made for the first URL is invalid on
     * the redirect target.
     */
    sign?: (url: string) => Record<string, string>;
  } = {},
  guard: (candidate: string) => Promise<void> = assertPublicHttpUrl,
): Promise<Response> {
  const { timeoutMs = 10_000, sign, ...rest } = init;
  // With the real guard the connection itself is checked too (DNS
  // rebinding); a test that swaps the guard out talks to its stub plainly.
  const fetchHop = guard === assertPublicHttpUrl ? pinnedFetch : fetch;
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await guard(current);

    const res = await fetchHop(current, {
      ...rest,
      headers: sign ? { ...(rest.headers as Record<string, string> | undefined), ...sign(current) } : rest.headers,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.status < 300 || res.status >= 400) return res;

    const location = res.headers.get("location");
    if (!location) throw new SafeFetchError("Redirect with no Location header.");
    // Relative redirects are resolved against the hop that issued them,
    // then re-checked like any other target.
    current = new URL(location, current).toString();
  }

  throw new SafeFetchError("Too many redirects.");
}
