import type { Metadata, Viewport } from "next";
// Inter from npm, not from Google: next/font/google fetched it from Google
// Fonts on every build. Each subset is its own @font-face with a
// unicode-range, so a browser downloads only the scripts a page uses.
import "@fontsource-variable/inter/wght.css";
import "./globals.css";
import { SessionProvider } from "@/components/session-provider";
import { LocaleProvider } from "@/components/locale-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { AppShell } from "@/components/app-shell";
import { AnnouncementsProvider } from "@/components/announcements";
import { AuthPromptProvider } from "@/components/auth-prompt";
import { THEME_INIT_SCRIPT } from "@/lib/theme-script";
import { APP_NAME } from "@platform/shared";
import { runningVersion } from "@platform/shared/node";
import { readPolicy } from "@/lib/policy";
import { FALLBACK_IMAGE, siteOrigin, siteHiddenFromSearch, NOINDEX } from "@/lib/link-preview";

// One family for the whole interface, headings included — the GitHub
// idiom this theme follows uses weight and size for hierarchy rather
// than a second display face. Inter covers Cyrillic, which is
// non-negotiable here: the app ships a real ru locale, and a face
// without it would fall back to a system font for exactly the readers
// the brand voice is aimed at. Served by this site (see the import above).

/**
 * Rendered per request, not prerendered at build time.
 *
 * This is what makes the CSP work at all. Next ships its hydration data
 * in *inline* `<script>` blocks, and an inline script is allowed only by
 * `unsafe-inline`, a hash, or a nonce. Next stamps its nonce by reading
 * the CSP off the incoming request — which only happens when there *is*
 * a request. Statically prerendered HTML is built long before one
 * exists, so those inline scripts shipped unsigned, the browser blocked
 * every one of them, and the page never hydrated.
 *
 * The cost is close to nothing here: almost every page is a client
 * component that fetches its own data, so the prerendered HTML was only
 * ever an empty shell.
 */
export const dynamic = "force-dynamic";

const SITE_DESCRIPTION = "Back the authors you read. Subscriptions, paid posts and tips — reading stays open.";

/**
 * The site's own card, for any page that has none of its own. A post, an
 * author or a folder replaces `openGraph`/`twitter` whole with its own
 * (`lib/link-preview.ts`). `metadataBase` is what makes every relative
 * URL in a card absolute: a crawler resolves nothing against the page.
 */
export async function generateMetadata(): Promise<Metadata> {
  const [origin, hidden] = await Promise.all([siteOrigin(), siteHiddenFromSearch()]);
  return {
    metadataBase: origin,
    // The whole server kept out of search engines: every page says so.
    ...(hidden ? { robots: NOINDEX } : {}),
    title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
    description: SITE_DESCRIPTION,
    openGraph: {
      type: "website",
      siteName: APP_NAME,
      title: APP_NAME,
      description: SITE_DESCRIPTION,
      images: [{ ...FALLBACK_IMAGE, alt: APP_NAME }],
    },
    twitter: { card: "summary", title: APP_NAME, description: SITE_DESCRIPTION, images: [FALLBACK_IMAGE.url] },
    // Served by this origin (next.config.mjs forwards them to the API, which
    // cuts every size from FAVICON in .env), so they load with the page.
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "48x48" },
        { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      ],
      apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
    },
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
  };
}

// The browser's own bar takes the default theme's ground: Twitter's white
// by day, X's black by night.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* First thing in <body>, not in a hand-written <head>: the App
            Router owns <head>, and rendering one here silently dropped
            this script *and* stopped Next stamping its CSP nonce onto
            its own bootstrap scripts — which `strict-dynamic` then
            blocked, so the page never hydrated at all.
            It still runs before the body paints, which is all the
            no-flash guarantee needs. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <ThemeProvider>
          <LocaleProvider>
            <SessionProvider>
              {/* Read here, on the server: CHANGELOG.md's first line, or
                  APP_VERSION in .env over it; and whether policy.md
                  exists, which decides if the policy is linked. */}
              <AuthPromptProvider>
                <AnnouncementsProvider>
                  <AppShell version={runningVersion()} policy={readPolicy() !== null}>
                    {children}
                  </AppShell>
                </AnnouncementsProvider>
              </AuthPromptProvider>
            </SessionProvider>
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
