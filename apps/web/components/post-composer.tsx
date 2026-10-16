"use client";

import { forwardRef, useId, useImperativeHandle, useRef, useState } from "react";
import { apiFetch, apiUpload, ApiError } from "@/lib/api";
import { useSession } from "./session-provider";
import { useLocale } from "./locale-provider";
import { PostEditor, type PostEditorHandle } from "./post-editor";
import { embedLine, embedName, hasOwnText } from "@platform/shared";
import { PostCoverField } from "./post-cover-field";
import { FileDropZone, newPendingUpload, type PendingUpload } from "./file-drop-zone";
import { overLimit, usePostLimit } from "./length-ring";
import { OPEN_ACCESS, PostAccessFields, accessBody, accessReady, type PostAccess } from "./post-access-fields";

export interface PublishedPost {
  id: string;
  slug: string;
}

/** Mirrors MAX_UPLOAD_BYTES on the API; only used to word the hint. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export interface PostComposerHandle {
  /** Puts the caret in the title, for "write a post" from elsewhere. */
  focus: () => void;
}

/**
 * Writing a post, start to publish: title, body, attachments, who may
 * read it, the cover behind the lock. One form for every place a post is
 * written — the "New post" page, the top of the feed and the floating
 * quick editor (`compact`: the attachments' hints are left out) — so the
 * three never drift apart.
 */
export const PostComposer = forwardRef<
  PostComposerHandle,
  { compact?: boolean; rows?: number; onPublished: (post: PublishedPost) => void }
>(function PostComposer({ compact = false, rows, onPublished }, ref) {
  const { t } = useLocale();
  const { user } = useSession();
  const id = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<PostEditorHandle>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const maxChars = usePostLimit();
  const [access, setAccess] = useState<PostAccess>(OPEN_ACCESS);
  const [files, setFiles] = useState<PendingUpload[]>([]);
  // The locked-post cover, held until the post exists to attach it to.
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Kept across a partial failure so a retry doesn't create a second post.
  const [draft, setDraft] = useState<PublishedPost | null>(null);

  useImperativeHandle(ref, () => ({ focus: () => titleRef.current?.focus() }), []);

  /**
   * One way in for every source: the picker, a drop, a paste. A file is
   * named in the text by its name (`![[name]]`), so a second file of the
   * same name is taken as "name (2)". Answers the names taken.
   */
  function addFiles(picked: File[]): string[] {
    if (picked.length === 0) return [];
    const taken = new Set(files.map((f) => f.file.name));
    const renamed = picked.map((file) => {
      if (!taken.has(file.name)) {
        taken.add(file.name);
        return file;
      }
      const dot = file.name.lastIndexOf(".");
      const [stem, ext] = dot > 0 ? [file.name.slice(0, dot), file.name.slice(dot)] : [file.name, ""];
      let n = 2;
      while (taken.has(`${stem} (${n})${ext}`)) n += 1;
      const name = `${stem} (${n})${ext}`;
      taken.add(name);
      return new File([file], name, { type: file.type, lastModified: file.lastModified });
    });
    setFiles((prev) => [...prev, ...renamed.map(newPendingUpload)]);
    return renamed.map((f) => f.name);
  }

  /** Rewrites (or, with `to` null, removes) the text's lines that place `from`. */
  function renamePlaced(from: string, to: string | null) {
    setContent((text) =>
      text
        .split("\n")
        .flatMap((line) => (embedName(line) === from ? (to === null ? [] : [embedLine(to)]) : [line]))
        .join("\n"),
    );
  }

  function setStatus(key: string, patch: Partial<PendingUpload>) {
    setFiles((prev) => prev.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  }

  /**
   * Uploads everything still outstanding against a product that now
   * exists. Returns false if any file failed, so the caller can stop
   * short of publishing rather than quietly publishing a post missing
   * the attachments the author added.
   */
  async function uploadPending(productId: string, pending: PendingUpload[]): Promise<boolean> {
    let allOk = true;
    for (const item of pending) {
      setStatus(item.key, { status: "uploading", error: undefined });
      try {
        await apiUpload(`/products/${productId}/attachments`, item.file, (phase) => setStatus(item.key, { phase }));
        setStatus(item.key, { status: "done" });
      } catch (err) {
        allOk = false;
        setStatus(item.key, {
          status: "error",
          error: err instanceof ApiError ? err.message : t("newPost.uploadError"),
        });
      }
    }
    return allOk;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // Reuse the draft when a previous attempt got as far as creating
      // it — otherwise a retry after a failed upload would duplicate.
      let product = draft;
      if (!product) {
        const created = await apiFetch<{ product: PublishedPost }>("/products/posts", {
          method: "POST",
          body: JSON.stringify({ title, content, ...accessBody(access, undefined) }),
        });
        product = created.product;
        setDraft(product);
      }

      // Only for a post that will be locked to someone: an open post shows
      // its body, and the cover is what stands in for it behind the lock.
      if (coverFile && access.visibility !== "PUBLIC") {
        await apiUpload(`/products/${product.id}/cover`, coverFile);
        setCoverFile(null);
      }

      const outstanding = files.filter((f) => f.status !== "done");
      const uploadsOk = outstanding.length === 0 || (await uploadPending(product.id, outstanding));
      if (!uploadsOk) {
        setError(t("newPost.someUploadsFailed"));
        return;
      }

      await apiFetch(`/products/${product.id}/publish`, { method: "POST" });
      setTitle("");
      setContent("");
      setAccess(OPEN_ACCESS);
      setFiles([]);
      setDraft(null);
      onPublished(product);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("newPost.createError"));
    } finally {
      setBusy(false);
    }
  }

  const canUpload = user?.canUploadFiles ?? false;

  return (
    <form className={`stack card post-composer${compact ? " compact" : ""}`} onSubmit={handleSubmit}>
      {error && <div className="error-banner">{error}</div>}
      <div className="form-field">
        <label htmlFor={`${id}-title`}>{t("common.title")}</label>
        <input id={`${id}-title`} ref={titleRef} required value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="form-field">
        <label htmlFor={`${id}-content`}>{t("form.content")}</label>
        <PostEditor
          ref={editorRef}
          id={`${id}-content`}
          rows={rows ?? (compact ? 8 : 14)}
          value={content}
          onChange={setContent}
          previewAs={user?.username ?? ""}
          // Paste or drop an image into the text and it joins the
          // attachments below — where every other file goes, so it
          // uploads with them when the post is created — and is placed
          // in the text right there (`![[name]]`).
          onFiles={canUpload && !busy ? addFiles : undefined}
        />
      </div>

      <div className="form-field">
        <label>{t("newPost.attachments")}</label>
        {canUpload ? (
          <>
            <FileDropZone
              onReplace={(key, file) => {
                const before = files.find((f) => f.key === key)?.file.name;
                setFiles((prev) => prev.map((f) => (f.key === key ? { ...f, file } : f)));
                if (before && before !== file.name) renamePlaced(before, file.name);
              }}
              onPlace={(key) => {
                const item = files.find((f) => f.key === key);
                if (item) editorRef.current?.place([item.file.name]);
              }}
              files={files}
              maxBytes={MAX_UPLOAD_BYTES}
              disabled={busy}
              onAdd={addFiles}
              onRemove={(key) => {
                const gone = files.find((f) => f.key === key)?.file.name;
                setFiles((prev) => prev.filter((f) => f.key !== key));
                if (gone) renamePlaced(gone, null);
              }}
            />
            {!compact && (
              <>
                <span className="meta">{t("newPost.attachmentsHint")}</span>
                <span className="meta">{t("newPost.pasteHint")}</span>
              </>
            )}
          </>
        ) : (
          // Server-side storage is a granted privilege, so the box is
          // replaced by the reason rather than failing on submit.
          <span className="lede">{t("editor.uploadsLocked")}</span>
        )}
      </div>

      <PostAccessFields value={access} onChange={setAccess} />
      {access.visibility !== "PUBLIC" && <PostCoverField pendingFile={coverFile} onPick={setCoverFile} />}
      {content.trim() && !hasOwnText(content) && <span className="meta">{t("newPost.needsText")}</span>}
      <button className="primary" type="submit" disabled={busy || !accessReady(access) || overLimit(content, maxChars) || !hasOwnText(content)}>
        {busy ? t("newPost.publishing") : t("newPost.publish")}
      </button>
    </form>
  );
});
