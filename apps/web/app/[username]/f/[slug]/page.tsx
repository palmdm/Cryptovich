import type { Metadata } from "next";
import { fetchPreview, previewMetadata } from "@/lib/link-preview";
import { FolderView } from "./folder-client";

/** The folder is the client component next door; this fills the `<head>` with its link-preview card. */
export async function generateMetadata({ params }: { params: Promise<{ username: string; slug: string }> }): Promise<Metadata> {
  const { username, slug } = await params;
  const preview = await fetchPreview(`folder/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`);
  return preview ? { ...(await previewMetadata(preview)), alternates: { canonical: preview.path } } : {};
}

export default async function FolderPage({ params }: { params: Promise<{ username: string; slug: string }> }) {
  return <FolderView params={await params} />;
}
