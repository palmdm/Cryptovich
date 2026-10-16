/** @type {import('next').NextConfig} */

// The content security policy is NOT here: it needs a per-request nonce so
// Next.js's own inline hydration scripts can run, which a static header
// cannot carry. See middleware.ts. The headers below are the ones that are
// genuinely the same on every response.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // Once a browser has seen the site over https it never tries plain http
  // again, so nobody on the way can strip the encryption. Browsers ignore
  // this header over http, so local development is unaffected.
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

// Where this server reaches the API itself. In docker-compose that is the
// `api` service; the browser never sees this address — it calls `/api/*`
// on the site's own origin and the request is forwarded here.
const apiInternalUrl = (process.env.API_INTERNAL_URL || "http://localhost:4000").replace(/\/$/, "");
// The status page's own service (apps/status). The gate (or nginx) sends
// /status there directly, which is what keeps it up when this server is
// not; this is only a way round for development (`pnpm dev`, the status
// service on :3005). The image is built with it empty — the status service
// lives on the host's loopback, which a container cannot reach — so there
// /status is the gate's alone.
const statusInternalUrl = (process.env.STATUS_INTERNAL_URL ?? "http://localhost:3005").replace(/\/$/, "");

const nextConfig = {
  reactStrictMode: true,
  // Nothing here uses next/image, and the optimizer behind /_next/image is
  // a server endpoint all the same: it decodes whatever image it is asked
  // to — the AVIF decoding flaw behind an unauthenticated code-execution
  // advisory among them. Off, it is not there to ask.
  images: { unoptimized: true },
  // Metadata goes in <head> for every browser, not only for crawlers.
  // Since Next 15.2 a page's <title>, icons and manifest link are streamed
  // into <body> for anything this list does not match, and a Chromium
  // browser looks for the manifest only in <head>: Vivaldi's "Page has no
  // manifest <link> URL", although installing still worked once scripts
  // had run. The cost is that a page waits for its generateMetadata.
  htmlLimitedBots: /.*/,
  eslint: { ignoreDuringBuilds: false },
  async headers() {
    // Country flags and notification sounds: plain files from public/,
    // the same bytes for everyone. Next sends them with max-age=0, so a
    // profile with a country flag asked for it again on every view; a day
    // in the browser, then a quiet re-check, is plenty (the names are not
    // hashed, so not "immutable").
    const staticFile = [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }];
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/flags/:file*", headers: staticFile },
      { source: "/sounds/:file*", headers: staticFile },
    ];
  },
  // Security and invites moved into the cabinet. Not permanent: a 308 is
  // remembered by the browser for good, which would outlive a move back.
  async redirects() {
    return [
      { source: "/settings/security", destination: "/dashboard/security", permanent: false },
      { source: "/settings/invites", destination: "/dashboard/invites", permanent: false },
    ];
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${apiInternalUrl}/:path*` },
      ...(statusInternalUrl
        ? [
            { source: "/status", destination: `${statusInternalUrl}/status` },
            { source: "/status.json", destination: `${statusInternalUrl}/status.json` },
          ]
        : []),
      // Federation, forwarded at the same paths it arrives on — not under
      // /api. Two things depend on that:
      //
      //  - `@alice@example.com` is resolved by asking example.com's root
      //    for /.well-known/webfinger, wherever the API itself lives.
      //  - an inbound delivery's HTTP signature covers the exact path it
      //    was sent to, so a rewritten path fails to verify.
      { source: "/.well-known/:path*", destination: `${apiInternalUrl}/.well-known/:path*` },
      { source: "/nodeinfo/:path*", destination: `${apiInternalUrl}/nodeinfo/:path*` },
      { source: "/federation/:path*", destination: `${apiInternalUrl}/federation/:path*` },
      // The site's icons and app manifest, at the root where browsers look
      // for them — asked of this origin like any static file, so nothing
      // in front of the site (a WAF, a proxy) has another host to reach.
      // The icon itself is FAVICON in the API's .env.
      { source: "/favicon.ico", destination: `${apiInternalUrl}/branding/favicon.ico` },
      { source: "/icon-:size(32|48|192|512).png", destination: `${apiInternalUrl}/branding/icon/:size.png` },
      { source: "/apple-touch-icon.png", destination: `${apiInternalUrl}/branding/icon/180.png` },
      { source: "/apple-touch-icon-precomposed.png", destination: `${apiInternalUrl}/branding/icon/180.png` },
      { source: "/manifest.webmanifest", destination: `${apiInternalUrl}/branding/manifest.webmanifest` },
      // Short links (the "Links" page, and personal links in posts) live
      // on the site's own domain: /s/<code> is answered by the API.
      { source: "/s/:code", destination: `${apiInternalUrl}/s/:code` },
    ];
  },
};

export default nextConfig;
