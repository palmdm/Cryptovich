"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "./locale-provider";
import { UploadIcon, TrashIcon } from "./icons";
import { UploadProgress } from "./upload-progress";
import { useImageEditor } from "./image-editor";
import type { UploadPhase } from "@/lib/api";

export type PendingUploadStatus = "pending" | "uploading" | "done" | "error";

export interface PendingUpload {
  /** Stable client-side id — the server has not seen this file yet. */
  key: string;
  file: File;
  status: PendingUploadStatus;
  error?: string;
  /** While uploading: how far along, so the row shows a moving bar. */
  phase?: UploadPhase;
}

export function newPendingUpload(file: File): PendingUpload {
  return { key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`, file, status: "pending" };
}

/**
 * A pasted screenshot has a name nobody recognises ("image.png"), so the
 * row shows the picture itself. The object URL is released when the row
 * goes away — without that every paste leaks the whole image.
 */
function Thumbnail({ file }: { file: File }) {
  const src = useMemo(() => (file.type.startsWith("image/") ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="upload-thumb" src={src} alt="" />;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Files are collected here and held in memory until the post they belong
 * to exists — an attachment needs a product id, and asking the author to
 * publish first just to attach something was the two-step flow this
 * replaces. Nothing is uploaded until submit.
 */
export function FileDropZone({
  files,
  onAdd,
  onRemove,
  onReplace,
  onPlace,
  disabled = false,
  maxBytes,
}: {
  files: PendingUpload[];
  onAdd: (files: File[]) => void;
  onRemove: (key: string) => void;
  /** A picture edited before it goes: the queued file is replaced. */
  onReplace?: (key: string, file: File) => void;
  /** Places the file in the post's text, at the caret. */
  onPlace?: (key: string) => void;
  disabled?: boolean;
  maxBytes: number;
}) {
  const { t } = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const editor = useImageEditor();

  function accept(list: FileList | null) {
    if (!list || disabled) return;
    onAdd(Array.from(list));
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      {editor.element}
      <div
        className={`drop-zone${dragging ? " is-dragging" : ""}${disabled ? " is-disabled" : ""}`}
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          accept(e.dataTransfer.files);
        }}
        onClick={() => !disabled && inputRef.current?.click()}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <UploadIcon size={20} />
        <strong>{t("newPost.dropHint")}</strong>
        <span className="meta">{t("newPost.dropLimit", { size: formatSize(maxBytes) })}</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          disabled={disabled}
          onChange={(e) => {
            accept(e.target.files);
            // Cleared so re-picking the same file still fires a change.
            e.target.value = "";
          }}
        />
      </div>

      {files.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          {files.map((item) => (
            <div key={item.key} className={`upload-row is-${item.status}`}>
              <Thumbnail file={item.file} />
              <span className="upload-name">{item.file.name}</span>
              <span className="meta">{formatSize(item.file.size)}</span>
              {item.status === "uploading" && (
                <span className="upload-row-progress">
                  <UploadProgress phase={item.phase ?? { stage: "sending", fraction: 0 }} />
                </span>
              )}
              {item.status === "done" && <span className="meta upload-ok">{t("newPost.uploaded")}</span>}
              {item.status === "error" && <span className="meta upload-failed">{item.error ?? t("newPost.uploadError")}</span>}
              {onReplace && item.status === "pending" && /^image\/(png|jpeg|gif|webp)$/.test(item.file.type) && (
                <button
                  type="button"
                  className="secondary upload-edit"
                  onClick={async () => {
                    const edited = await editor.edit(item.file);
                    if (edited && edited !== item.file) onReplace(item.key, edited);
                  }}
                >
                  {t("imageEditor.edit")}
                </button>
              )}
              {onPlace && item.status !== "error" && (
                <button type="button" className="secondary upload-place" onClick={() => onPlace(item.key)} title={t("newPost.placeHint")}>
                  {t("newPost.place")}
                </button>
              )}
              {item.status !== "uploading" && (
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => onRemove(item.key)}
                  aria-label={t("newPost.removeFile", { name: item.file.name })}
                  title={t("common.remove")}
                >
                  <TrashIcon size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
