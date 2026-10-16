import type { Metadata } from "next";
import { noteUri } from "@/lib/post-note";
import { fetchPreview, previewMetadata } from "@/lib/link-preview";
import { ProductView } from "./post-client";

/**
 * A post, at `/<author>/posts/<id>` — the address Boosty uses, and the one
 * every link here now makes. The page itself is the client component next
 * door; this wrapper fills the `<head>`: the link-preview card and the
 * post's ActivityPub Note.
 */
export async function generateMetadata({ params }: { params: Promise<{ username: string; id: string }> }): Promise<Metadata> {
  const { username, id } = await params;
  const [note, preview] = await Promise.all([
    noteUri(username, id),
    fetchPreview(`post/${encodeURIComponent(username)}/${encodeURIComponent(id)}`),
  ]);
  return {
    ...(preview ? await previewMetadata(preview) : {}),
    alternates: {
      ...(preview ? { canonical: preview.path } : {}),
      ...(note ? { types: { "application/activity+json": note } } : {}),
    },
  };
}

export default async function PostPage({ params }: { params: Promise<{ username: string; id: string }> }) {
  const { username, id } = await params;
  return <ProductView params={{ username, ref: id }} />;
}
