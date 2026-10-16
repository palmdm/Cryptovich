import { NextResponse, type NextRequest } from "next/server";
import { THEME_INIT_SCRIPT_CSP_HASH } from "./lib/theme-script";

/**
 * The content security policy, set per request so it can carry a nonce.
 *
 * It cannot be a static header: Next.js App Router ships its hydration
 * data in inline `<script>` tags, so a policy of `script-src 'self'` with
 * no nonce blocks them, React never hydrates, and every page freezes on
 * whatever the server rendered — which is exactly what happened when this
 * policy first shipped from next.config.mjs.
 *
 * Next.js reads the nonce back out of this header and stamps it onto its
 * own inline scripts, so they run while an injected one still cannot.
 * `strict-dynamic` lets those scripts load the chunks they need without
 * the policy having to enumerate them.
 */
export function middleware(request: NextRequest) {
  // The status page is another service's (apps/status) with rules of its
  // own; this one's would only get in their way.
  if (request.nextUrl.pathname === "/status" || request.nextUrl.pathname === "/status.json") return NextResponse.next();
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  // The default API URL is the relative `/api`, which `'self'` already
  // covers; only an API on another origin needs naming.
  const configuredApi = process.env.NEXT_PUBLIC_API_URL ?? "";
  const apiOrigin = /^https?:\/\//.test(configuredApi) ? new URL(configuredApi).origin : "";

  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    // One click here can confirm a payment, so nothing may frame this app.
    "frame-ancestors 'none'",
    "form-action 'self'",
    // No 'strict-dynamic' here, deliberately.
    //
    // It discards host allowlists, so `'self'` stops meaning anything and
    // only nonce/hash-allowed scripts run. That works when every page is
    // server-rendered per request — Next can then stamp its bootstrap
    // scripts with the nonce. Almost every page here is *statically*
    // prerendered, and prerendered HTML is built long before any request
    // exists, so those scripts carry no nonce at all: the policy blocked
    // Next's own chunks and the app never hydrated.
    //
    // `'self'` plus the nonce and hash is the right policy for static
    // output: same-origin chunks load, the inline theme stamp is allowed
    // by its hash, any dynamically rendered page still gets the nonce,
    // and `unsafe-inline` is still absent — so an injected inline script
    // cannot run.
    // `next dev` runs its hot reloader through eval, so a development
    // server never hydrated under this policy — every page stuck on
    // "Loading…". Only there; a production build needs no eval.
    `script-src 'self' 'nonce-${nonce}' ${THEME_INIT_SCRIPT_CSP_HASH}${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    // Next.js inlines critical CSS and this app uses inline style
    // attributes. That is a real weakening for CSS injection, and none for
    // script execution.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    // Authors legitimately host avatars and custom emoji elsewhere, and an
    // image cannot execute.
    `img-src 'self' data: blob: https: ${apiOrigin}`.trim(),
    `media-src 'self' ${apiOrigin}`.trim(),
    `connect-src 'self' ${apiOrigin}`.trim(),
    // Spotify's player, and only once a reader asks for it (SpotifyEmbed).
    "frame-src https://open.spotify.com",
  ].join("; ");

  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  // Next.js looks for the nonce on the *request's* CSP header.
  headers.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  // A site served over HTTPS tells browsers to keep using it: a later
  // visit typed as http:// is not a moment someone in between can use.
  // Without includeSubDomains — other services may live on this domain.
  if ((process.env.WEB_ORIGIN ?? "").startsWith("https://")) {
    response.headers.set("Strict-Transport-Security", "max-age=31536000");
  }
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and prefetches, which carry no
    // inline script and would only pay the cost of running this.
    {
      // `/api` is the proxied API: JSON and files, not pages.
      source: "/((?!_next/static|_next/image|favicon.ico|icon-|apple-touch-icon|manifest.webmanifest|sw.js|offline.html|flags/|sounds/|api/).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
