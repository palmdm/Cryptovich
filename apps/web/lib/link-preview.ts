import type { Metadata } from "next";
import { headers } from "next/headers";
import { APP_NAME } from "@platform/shared";

/** Asked server-side, over the internal network — never from the browser. */
const API_INTERNAL_URL = (process.env.API_INTERNAL_URL || "http://localhost:4000").replace(/\/$/, "");

/** `GET /previews/...` — built by the API for a signed-out reader only. */
export interface LinkPreview {
  kind: "post" | "profile" | "folder";
  title: string;
  description: string | null;
  image: string | null;
  imageWide: boolean;
  path: string;
  author: { username: string; displayName: string };
  publishedAt: string | null;
  locked: boolean;
  /** The author keeps out of search engines. */
  noindex?: boolean;
}

/**
 * The address people open, which every relative URL in a card is resolved
 * against. WEB_ORIGIN (the same `.env` the API reads) when it is set;
 * otherwise the host this request arrived on, so a development server's
 * cards point at itself rather than at Next's `localhost:3000` default.
 */
export async function siteOrigin(): Promise<URL | undefined> {
  try {
    if (process.env.WEB_ORIGIN) return new URL(process.env.WEB_ORIGIN);
  } catch {
    // An unparseable WEB_ORIGIN falls through to the request's own host.
  }
  const h = await headers();
  const host = h.get("x-forwarded-host")?.split(",")[0]?.trim() || h.get("host");
  if (!host) return undefined;
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
  try {
    return new URL(`${proto}://${host}`);
  } catch {
    return undefined;
  }
}

/** `path` is under `/previews/`, with every segment already encoded. */
export async function fetchPreview(path: string): Promise<LinkPreview | null> {
  try {
    // A card is the same for everyone, so one fetch a minute per page
    // serves every visitor and every crawler.
    const res = await fetch(`${API_INTERNAL_URL}/previews/${path}`, { next: { revalidate: 60 } });
    // 404 is ordinary — a draft, a deleted post, a mistyped name — and the
    // page then keeps the site's own card.
    if (!res.ok) return null;
    return ((await res.json()) as { preview?: LinkPreview }).preview ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether the administrator keeps the whole server out of search engines
 * (Admin → Parameters → «Поисковики»). Asked server-side, a minute stale at
 * most; a server that cannot be asked is not hidden.
 */
export async function siteHiddenFromSearch(): Promise<boolean> {
  try {
    const res = await fetch(`${API_INTERNAL_URL}/previews/site`, { next: { revalidate: 60 } });
    if (!res.ok) return false;
    return Boolean(((await res.json()) as { noindex?: boolean }).noindex);
  } catch {
    return false;
  }
}

export const NOINDEX: Metadata["robots"] = { index: false, follow: false, noarchive: true, nocache: true, googleBot: { index: false, follow: false, noimageindex: true } };

export const FALLBACK_IMAGE = { url: "/icon-512.png", width: 512, height: 512 };

/**
 * Open Graph and Twitter Card tags for one page — what Telegram, X,
 * Mastodon, Discord and the rest draw when its link is pasted. Next
 * replaces the layout's `openGraph`/`twitter` wholesale rather than
 * merging them, so this states every field the site-wide card does.
 */
export async function previewMetadata(preview: LinkPreview): Promise<Metadata> {
  const origin = await siteOrigin();
  const { author } = preview;
  const title = preview.kind === "profile" ? `${preview.title} (@${author.username})` : preview.title;
  // Names only: a fallback in words would be in one language for a site
  // read in three, and a chat client shows it to everyone alike.
  const description =
    preview.description ??
    (preview.kind === "profile" ? `@${author.username}` : `${author.displayName} (@${author.username})`);
  const image = preview.image ? { url: preview.image, alt: title } : { ...FALLBACK_IMAGE, alt: APP_NAME };

  const common = { siteName: APP_NAME, title, description, url: preview.path, images: [image] };
  const openGraph: Metadata["openGraph"] =
    preview.kind === "post"
      ? {
          ...common,
          type: "article",
          ...(preview.publishedAt ? { publishedTime: preview.publishedAt } : {}),
          // Not resolved against metadataBase the way `url` and images are.
          authors: [new URL(`/${author.username}`, origin ?? "http://localhost").href],
        }
      : preview.kind === "profile"
        ? { ...common, type: "profile", username: author.username }
        : { ...common, type: "website" };

  return {
    title,
    description,
    openGraph,
    twitter: {
      card: preview.imageWide ? "summary_large_image" : "summary",
      title,
      description,
      images: [image],
    },
    // The author's own choice (Кабинет → «Поисковики»): search engines
    // leave the page and its links alone. A chat's link card is not a
    // search engine, so the card itself stays.
    ...(preview.noindex ? { robots: NOINDEX } : {}),
  };
}
