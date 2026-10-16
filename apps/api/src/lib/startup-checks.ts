import { lookup } from "node:dns/promises";

/**
 * Configuration mistakes that break something only another server can
 * see, checked once at startup and reported in the API's own log.
 *
 * A wrong scheme in WEB_ORIGIN / API_PUBLIC_URL is the example this
 * exists for: every federation URL is built from it, so a plain-http
 * value publishes http actor URLs that no fediverse server will fetch.
 * Nothing local looks wrong — the failure surfaces as an opaque "remote
 * data could not be fetched" on somebody else's instance.
 */

interface PublicUrlEnv {
  WEB_ORIGIN?: string;
  API_PUBLIC_URL?: string;
  NODE_ENV?: string;
}

/** A host where plain http is normal and no warning is warranted. */
function isLocal(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  );
}

export function publicUrlWarnings(env: PublicUrlEnv = process.env): string[] {
  const warnings: string[] = [];

  for (const name of ["WEB_ORIGIN", "API_PUBLIC_URL"] as const) {
    const raw = env[name];
    if (!raw) continue;

    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      warnings.push(`${name}='${raw}' is not a URL. It must be the address people open, e.g. https://example.com.`);
      continue;
    }

    if (url.protocol === "http:" && !isLocal(url.hostname)) {
      warnings.push(
        `${name}='${raw}' uses http on a public host. Federation publishes this address to other servers, ` +
          `and they refuse plain http — set it to https://${url.host}${url.pathname === "/" ? "" : url.pathname}.`,
      );
    }
  }

  const web = env.WEB_ORIGIN;
  const api = env.API_PUBLIC_URL;
  if (web && api) {
    try {
      if (new URL(web).origin !== new URL(api).origin) {
        warnings.push(
          `WEB_ORIGIN ('${web}') and API_PUBLIC_URL ('${api}') are on different origins. That is only right when the ` +
            `API really is served from another host; behind the site's own /api proxy they share one.`,
        );
      }
    } catch {
      // Already reported above as unparseable.
    }
  }

  return warnings;
}

export function reportStartupChecks(warnings: string[]): void {
  for (const warning of warnings) console.warn(`[config] ${warning}`);
}

/**
 * The federation state that looks like a bug from outside: authors switched
 * on, the server switch off. Every actor then answers "Account could not be
 * found", which says nothing about why — so the log says it at start.
 */
export async function federationWarnings(prisma: {
  serverSetting: { findUnique: (args: { where: { key: string } }) => Promise<{ value: string } | null> };
  creatorFederationSettings: { count: (args: { where: { enabled: boolean } }) => Promise<number> };
}): Promise<string[]> {
  const [setting, enabledAuthors] = await Promise.all([
    prisma.serverSetting.findUnique({ where: { key: "federationEnabled" } }),
    prisma.creatorFederationSettings.count({ where: { enabled: true } }),
  ]);
  // Only an explicit "false" turns federation off — see SERVER_SETTINGS.
  if (setting?.value !== "false" || enabledAuthors === 0) return [];
  return [
    `federation is switched on for ${enabledAuthors} author(s) but off for the server, so every actor answers 404. ` +
      "Turn it on in Admin → Server settings, or: ./scripts/manage-users.sh federation-enable",
  ];
}

/**
 * Whether this process can resolve a public hostname at all. Every remote
 * actor, key and inbox is looked up by name, so a container without
 * working DNS rejects every Follow as "could not resolve the signing key"
 * and never delivers anything — while pages, the actor and the avatar all
 * still serve, because *other* servers fetching from here need no DNS on
 * this side. The domain looked up is this site's own, so the check asks
 * the resolver one question and contacts no third party.
 */
export async function dnsWarnings(
  publicUrl: string,
  resolve: (hostname: string) => Promise<unknown> = (hostname) => lookup(hostname),
  timeoutMs = 5_000,
): Promise<string[]> {
  let hostname: string;
  try {
    hostname = new URL(publicUrl).hostname;
  } catch {
    return [];
  }
  if (isLocal(hostname)) return [];

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      resolve(hostname),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("timed out"), { code: "ETIMEOUT" })), timeoutMs);
      }),
    ]);
    return [];
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "lookup failed";
    return [
      `DNS does not work in this container (${code} looking up ${hostname}). No fediverse server can follow ` +
        "anyone here: every Follow is rejected because the follower's key cannot be fetched, and nothing is " +
        "delivered. Diagnose with: ./scripts/manage-users.sh federation-check",
    ];
  } finally {
    clearTimeout(timer);
  }
}
