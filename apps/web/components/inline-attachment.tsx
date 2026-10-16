"use client";

import { API_URL } from "@/lib/api";
import { useLocale } from "./locale-provider";
import { ImageGallery } from "./image-gallery";
import { DownloadIcon, FileIcon } from "./icons";

/** An attachment as the post page has it — `url` is the gated download route. */
export interface InlineAttachment {
  id: string;
  kind: "IMAGE" | "VIDEO" | "AUDIO" | "FILE";
  mimeType: string;
  sizeBytes: number;
  originalFilename: string;
  altText: string | null;
  url: string;
}

function size(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * A file placed in a post's text (`![[name]]`): a picture that opens in the
 * viewer, a player, or a file to download right where the author put it.
 * Every request goes through the download route, which checks access each
 * time — the same as the files under the post.
 */
export function InlineFile({ attachment }: { attachment: InlineAttachment }) {
  const { t } = useLocale();
  const src = `${API_URL}${attachment.url}`;
  if (attachment.kind === "IMAGE") {
    return (
      <div className="inline-file is-image">
        <ImageGallery variant="full" images={[{ url: attachment.url, alt: attachment.altText ?? attachment.originalFilename }]} />
      </div>
    );
  }
  if (attachment.kind === "VIDEO") return <video className="inline-file is-video" src={src} controls preload="metadata" />;
  if (attachment.kind === "AUDIO") return <audio className="inline-file is-audio" src={src} controls preload="metadata" />;
  return (
    <a className="inline-file is-download" href={src} download={attachment.originalFilename}>
      <FileIcon size={22} />
      <span className="inline-file-name">
        <strong>{attachment.originalFilename}</strong>
        <span className="meta">{size(attachment.sizeBytes)}</span>
      </span>
      <span className="inline-file-action">
        <DownloadIcon size={17} />
        {t("files.download")}
      </span>
    </a>
  );
}

/** Where a file will be, while the post is still being written (it is uploaded on publishing). */
export function PendingFile({ name }: { name: string }) {
  return (
    <div className="inline-file is-pending">
      <FileIcon size={18} />
      <span>{name}</span>
    </div>
  );
}
