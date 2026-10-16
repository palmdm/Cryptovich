import type { Metadata } from "next";
import { ProductView } from "../../posts/[id]/post-client";
import { noteUri } from "@/lib/post-note";
import { fetchPreview, previewMetadata } from "@/lib/link-preview";

/**
 * Where posts lived before `/<author>/posts/<id>`: `/<author>/p/<slug>`.
 * Those links are out there — shared, bookmarked, and in the `url` of
 * every Note already delivered to the fediverse — so this still renders
 * the post, and the page then moves the browser on to its current address.
 */
export async function generateMetadata({ params }: { params: Promise<{ username: string; slug: string }> }): Promise<Metadata> {
  const { username, slug } = await params;
  const [note, preview] = await Promise.all([
    noteUri(username, slug),
    fetchPreview(`post/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`),
  ]);
  return {
    ...(preview ? await previewMetadata(preview) : {}),
    alternates: {
      ...(preview ? { canonical: preview.path } : {}),
      ...(note ? { types: { "application/activity+json": note } } : {}),
    },
  };
}

export default async function LegacyPostPage({ params }: { params: Promise<{ username: string; slug: string }> }) {
  const { username, slug } = await params;
  return <ProductView params={{ username, ref: slug }} />;
}
