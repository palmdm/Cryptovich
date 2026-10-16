import type { Metadata } from "next";
import { CreatorProfile } from "./profile-client";
import { fetchPreview, previewMetadata } from "@/lib/link-preview";

/**
 * The page itself is the client component next door. This wrapper exists
 * for the `<head>`: the link-preview card (`lib/link-preview.ts`), and
 * `<link rel="alternate" type="application/activity+json">`,
 * which is how a fediverse server — or anything else handed a profile URL
 * — finds the author's actor. Without it a paste of this page's address
 * into Mastodon reports that no ActivityPub account was found, even
 * though WebFinger answers for the handle perfectly well.
 *
 * A client component cannot export metadata, which is why the page is
 * split rather than annotated in place.
 */

/** Asked server-side, over the internal network — never from the browser. */
const API_INTERNAL_URL = (process.env.API_INTERNAL_URL || "http://localhost:4000").replace(/\/$/, "");

async function actorUri(username: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_INTERNAL_URL}/federation/users/${encodeURIComponent(username)}`, {
      headers: { Accept: "application/activity+json" },
      // Federation is switched on and off rarely; re-asking on every page
      // view would put a request on the API for each visitor.
      next: { revalidate: 300 },
    });
    // 404 here is the ordinary case: an author who has not turned
    // federation on has no actor to advertise.
    if (!res.ok) return null;
    const actor = (await res.json()) as { id?: string };
    return typeof actor.id === "string" ? actor.id : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  const { username } = await params;
  const [actor, preview] = await Promise.all([actorUri(username), fetchPreview(`profile/${encodeURIComponent(username)}`)]);
  return {
    ...(preview ? await previewMetadata(preview) : { title: `@${username}` }),
    alternates: {
      ...(preview ? { canonical: preview.path } : {}),
      ...(actor ? { types: { "application/activity+json": actor } } : {}),
    },
  };
}

export default async function CreatorProfilePage({ params }: { params: Promise<{ username: string }> }) {
  return <CreatorProfile params={await params} />;
}
