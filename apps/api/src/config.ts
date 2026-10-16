function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Registration mode, the federation policy, the upload limit, mail and
// the rest an administrator may change are not here: they are settings
// (modules/settings/service.ts), with these variables as their defaults.

/**
 * Which hops of X-Forwarded-For to believe, i.e. how `request.ip` — and so
 * every per-address rate limit — is decided.
 *
 * Believing all of them (`true`) let a client name any address it liked:
 * the left-most entry is whatever the client sent, and proxies only
 * append to it. The default trusts hops on loopback and private networks
 * — the web container, nginx, a WAF on the same host — and takes the
 * first address outside them as the client. TRUST_PROXY overrides it: a
 * hop count ("2"), addresses or ranges ("10.0.0.0/8,173.245.48.0/20"),
 * or "true" for the old behaviour.
 */
export function parseTrustProxy(raw: string | undefined): boolean | string[] | ((address: string, hop: number) => boolean) {
  const value = raw?.trim();
  if (!value) return ["loopback", "linklocal", "uniquelocal"];
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^\d+$/.test(value)) {
    // "N proxies in front": believe the last N hops and no more.
    const hops = Number(value);
    return (_address, hop) => hop < hops;
  }
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

export const config = {
  port: Number(process.env.API_PORT ?? 4000),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  redisUrl: required("REDIS_URL", "redis://localhost:6379"),
  webOrigin: required("WEB_ORIGIN", "http://localhost:3000"),
  sessionCookieName: "platform_session",
  // A Secure cookie is dropped by the browser on a plain-http site (other
  // than localhost), and login then silently fails to stick. So it follows
  // the scheme the site is actually served on; COOKIE_SECURE overrides.
  cookieSecure:
    process.env.COOKIE_SECURE !== undefined && process.env.COOKIE_SECURE !== ""
      ? process.env.COOKIE_SECURE === "true"
      : (process.env.NODE_ENV ?? "development") === "production" &&
        (process.env.WEB_ORIGIN ?? "").startsWith("https://"),
  sessionTtlSeconds: 60 * 60 * 24 * 30,
  isProduction: (process.env.NODE_ENV ?? "development") === "production",
  uploadDir: process.env.UPLOAD_DIR ?? "./data/uploads",
  // The API's own externally-reachable origin — distinct from `webOrigin`
  // (the frontend's origin, used for CORS). Anything handed to another
  // server — attachment URLs in a federated Note, an avatar in an actor —
  // needs an absolute URL it can fetch directly, not a path relative to
  // whatever origin happens to be making the request.
  apiPublicUrl: process.env.API_PUBLIC_URL ?? `http://localhost:${Number(process.env.API_PORT ?? 4000)}`,
  // Where federation lives, which is not always where the API lives.
  //
  // `@alice@example.com` is resolved by asking example.com's *root* for
  // /.well-known/webfinger, and an inbound delivery's signature covers the
  // exact path it was sent to — so when the API is served under a path
  // (the site's own /api proxy), the federation endpoints must still sit
  // at the origin's root and be proxied there path-for-path. With the API
  // on its own host this is simply its origin, as before.
  federationBaseUrl: new URL(
    process.env.API_PUBLIC_URL ?? `http://localhost:${Number(process.env.API_PORT ?? 4000)}`,
  ).origin,
  // Object storage. Unset S3_BUCKET keeps uploads on local disk, which
  // is what a single-host deployment wants; setting it moves them to any
  // S3-compatible bucket without changing how downloads are gated.
  s3Bucket: process.env.S3_BUCKET ?? "",
  s3Region: process.env.S3_REGION ?? "auto",
  s3Endpoint: process.env.S3_ENDPOINT ?? "",
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
};
