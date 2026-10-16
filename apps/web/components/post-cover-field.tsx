"use client";

import { useEffect, useState } from "react";
import { apiFetch, apiUpload, localizedErrorMessage, type UploadPhase } from "@/lib/api";
import { uploadedImageSrc } from "@/lib/uploaded-image";
import { UploadProgress } from "./upload-progress";
import { useLocale } from "./locale-provider";
import { useImageEditor } from "./image-editor";

const ACCEPT = "image/png,image/jpeg,image/gif,image/webp";

/**
 * The cover a reader without access sees behind a locked post's lock.
 *
 * With `productId` (editing) a picked image uploads at once and the saved
 * cover shows. Without one (a post not created yet) the picked file is held
 * and previewed locally, and the form uploads it once the post exists.
 */
export function PostCoverField({
  productId,
  coverUrl,
  onSaved,
  pendingFile,
  onPick,
}: {
  productId?: string;
  coverUrl?: string | null;
  onSaved?: (coverUrl: string | null) => void;
  pendingFile?: File | null;
  onPick?: (file: File | null) => void;
}) {
  const { t } = useLocale();
  const [phase, setPhase] = useState<UploadPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const editor = useImageEditor();

  // A held file is previewed from memory; the object URL is released when
  // the file changes or the field goes away.
  useEffect(() => {
    if (!pendingFile) {
      setLocalPreview(null);
      return;
    }
    const url = URL.createObjectURL(pendingFile);
    setLocalPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFile]);

  const shown = localPreview ?? (coverUrl ? uploadedImageSrc(coverUrl) : null);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!picked) return;
    const file = await editor.edit(picked, { maxSide: 2400 });
    if (!file) return;
    setError(null);
    if (!productId) {
      onPick?.(file);
      return;
    }
    try {
      const res = await apiUpload<{ product: { coverUrl: string | null } }>(`/products/${productId}/cover`, file, setPhase);
      onSaved?.(res.product.coverUrl);
    } catch (err) {
      setError(localizedErrorMessage(err, t, "cover.uploadError"));
    } finally {
      setPhase(null);
    }
  }

  async function remove() {
    setError(null);
    if (!productId) {
      onPick?.(null);
      return;
    }
    try {
      await apiFetch(`/products/${productId}/cover`, { method: "DELETE" });
      onSaved?.(null);
    } catch (err) {
      setError(localizedErrorMessage(err, t, "cover.uploadError"));
    }
  }

  return (
    <div className="form-field">
      <label>{t("cover.title")}</label>
      {error && <div className="error-banner">{error}</div>}
      {shown && (
        <div className={`post-cover-preview${phase ? " uploading-preview" : ""}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shown} alt="" />
        </div>
      )}
      <div className="row" style={{ gap: 8 }}>
        <label className="btn-secondary file-pick">
          {shown ? t("cover.replace") : t("cover.choose")}
          <input type="file" accept={ACCEPT} onChange={pick} disabled={phase !== null} hidden />
        </label>
        {shown && (
          <button type="button" className="secondary" onClick={remove} disabled={phase !== null}>
            {t("cover.remove")}
          </button>
        )}
      </div>
      <UploadProgress phase={phase} />
      <span className="meta">{t("cover.hint")}</span>
      {editor.element}
    </div>
  );
}
