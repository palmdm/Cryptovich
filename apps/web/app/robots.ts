import type { MetadataRoute } from "next";
import { siteHiddenFromSearch } from "@/lib/link-preview";

// Asked again at most once a minute: the administrator can switch it.
export const revalidate = 60;

/**
 * What search engines may crawl. The pages people read are open — an
 * author who keeps out of search says so on their own pages (noindex,
 * lib/link-preview.ts) — and the rest is someone's own or the API's. A
 * server its administrator keeps out of search turns every crawler away.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  if (await siteHiddenFromSearch()) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/admin", "/dashboard", "/settings", "/notifications", "/bookmarks", "/library", "/feed", "/link/", "/federation/"],
    },
  };
}
