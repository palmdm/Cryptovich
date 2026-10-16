/**
 * Which instances this server will federate with at all.
 *
 * Distinct from the admin-curated instance allowlist in the database,
 * which is about *where an author chooses to cross-post*. This is the
 * operator's own limit, set at deploy time: every follower is a delivery
 * on every future post, so an open instance's outbound traffic grows with
 * the whole network whether or not anyone here wanted that.
 *
 * Applied in two places, and both matter. Refusing a follow stops the
 * follower being recorded at all; filtering delivery targets means a
 * policy tightened later takes effect on followers already stored,
 * without a migration.
 */
export type FederationMode = "open" | "allowlist";

export interface FederationPolicy {
  mode: FederationMode;
  /** Consulted only in `allowlist` mode. */
  allowed: string[];
  /** Always refused, in either mode — a blocklist outranks an allowlist. */
  blocked: string[];
}

/**
 * Parses a comma or whitespace separated list of hosts.
 *
 * A leading dot means "this domain and everything under it", so
 * `.example.com` covers `a.example.com` without also matching
 * `notexample.com`. Without the dot the match is exact, which is the
 * safer default: an operator listing `mastodon.social` has not implicitly
 * agreed to federate with anything that happens to end in that string.
 */
export function parseDomainList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    // Tolerate a pasted URL or an @user@host, so a misformatted entry
    // does not silently match nothing.
    .map((entry) => {
      const withoutScheme = entry.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
      const withoutUser = withoutScheme.replace(/^@?[^@/]*@/, "");
      return withoutUser.split("/")[0]!.replace(/:\d+$/, "");
    })
    .filter(Boolean);
}

function matches(host: string, pattern: string): boolean {
  if (pattern.startsWith(".")) {
    const bare = pattern.slice(1);
    return host === bare || host.endsWith(pattern);
  }
  return host === pattern;
}

/** The host a URL or bare domain refers to, lowercased and portless. */
export function hostOf(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    const bare = value.trim().toLowerCase().split("/")[0]!.replace(/:\d+$/, "");
    return bare || null;
  }
}

/**
 * Whether this server will exchange anything with a host. Unparseable
 * input is refused rather than allowed — a target we cannot identify is
 * not one to send signed requests to.
 */
export function isFederationAllowed(target: string, policy: FederationPolicy): boolean {
  const host = hostOf(target);
  if (!host) return false;

  if (policy.blocked.some((pattern) => matches(host, pattern))) return false;
  if (policy.mode === "open") return true;
  return policy.allowed.some((pattern) => matches(host, pattern));
}
