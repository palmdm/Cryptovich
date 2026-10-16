import { FeedIngestionProviderError } from "./provider.js";
import { pinnedFetch } from "./pinned-fetch.js";

export const FEED_TIMEOUT_MS = 15_000;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Turns a network-level failure into something an author can act on.
 *
 * Left unwrapped, `fetch` rejects with a bare `TypeError: fetch failed`
 * whose real cause is buried in `err.cause.code` — and that string went
 * straight to the connect form, telling the author nothing about whether
 * their URL was wrong, the remote server was down, or this server simply
 * has no route to the internet. The last case is the one worth calling
 * out: it is not the author's mistake and no amount of retyping the URL
 * will fix it.
 */
export function describeFetchFailure(url: string, error: unknown): string {
  const host = hostOf(url);
  const code = (error as { cause?: { code?: string } } | undefined)?.cause?.code;
  const name = error instanceof Error ? error.name : "";

  if (name === "TimeoutError" || name === "AbortError") {
    return `${host} didn't respond within ${FEED_TIMEOUT_MS / 1000} seconds.`;
  }
  switch (code) {
    case "ENOTFOUND":
      return `No server found at ${host} — check the address for a typo.`;
    case "EAI_AGAIN":
      return `Couldn't look up ${host}. The address may be wrong, or this server's DNS isn't working.`;
    case "ECONNREFUSED":
      return `${host} refused the connection.`;
    case "ECONNRESET":
      return `${host} closed the connection before responding.`;
    case "ETIMEDOUT":
      return `Couldn't reach ${host}. Either it is down, or this server has no outbound internet access.`;
    case "CERT_HAS_EXPIRED":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
      return `${host} has an invalid HTTPS certificate.`;
    default:
      return `Couldn't reach ${host}${code ? ` (${code})` : ""}.`;
  }
}

/**
 * `fetch` with a timeout and the diagnostics above. SSRF checking stays
 * with the callers, which re-check every redirect hop themselves.
 */
export async function fetchFeedResource(
  url: string,
  accept: string,
  extraHeaders?: Record<string, string>,
  /** Check the address at connect time too — on whenever the caller uses the real SSRF guard. */
  pinned = true,
): Promise<Response> {
  try {
    return await (pinned ? pinnedFetch : fetch)(url, {
      headers: { Accept: accept, ...extraHeaders },
      redirect: "manual",
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    });
  } catch (error) {
    // An SSRF rejection is a deliberate refusal, not a network fault —
    // let it through with its own message intact.
    if (error instanceof FeedIngestionProviderError) throw error;
    throw new FeedIngestionProviderError(describeFetchFailure(url, error));
  }
}
