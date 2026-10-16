"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { postPathFor } from "@platform/shared";
import { apiFetch, API_URL, localizedErrorMessage } from "@/lib/api";
import { useLocale } from "@/components/locale-provider";
import { useSession } from "@/components/session-provider";
import { DownloadIcon, FileIcon, SearchIcon, TrashIcon } from "@/components/icons";
import type { TranslationKey } from "@/lib/i18n/en";
import { formatDate } from "@/lib/dates";
import { Loading } from "@/components/loading";

type Kind = "" | "image" | "video" | "audio" | "other";

interface StoredFile {
  key: string;
  source: "attachment" | "folder" | "product-file" | "post-cover";
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number | null;
  createdAt: string;
  product: { id: string; title: string; deleted: boolean } | null;
  folder: { id: string; title: string } | null;
  downloadPath: string;
  deletable: boolean;
}

const KINDS: { value: Kind; label: TranslationKey }[] = [
  { value: "", label: "myFiles.kindAll" },
  { value: "image", label: "myFiles.kindImage" },
  { value: "video", label: "myFiles.kindVideo" },
  { value: "audio", label: "myFiles.kindAudio" },
  { value: "other", label: "myFiles.kindOther" },
];

function formatSize(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Every file the author has stored here, in one place: find one by its
 * name or the post it is in, download it, or delete it on its own — an
 * image from a post without deleting the post.
 */
export default function FilesPage() {
  const { t, locale } = useLocale();
  const { user } = useSession();
  const [files, setFiles] = useState<StoredFile[] | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind>("");
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (kind) params.set("kind", kind);
    try {
      const res = await apiFetch<{ files: StoredFile[] }>(`/files/mine?${params.toString()}`);
      setFiles(res.files);
      setError(null);
    } catch (err) {
      setError(localizedErrorMessage(err, t, "myFiles.loadError"));
    }
  }, [query, kind, t]);

  // Typing searches after a short pause rather than on every key.
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  async function remove(file: StoredFile) {
    if (!window.confirm(t("myFiles.deleteConfirm", { name: file.name }))) return;
    setBusyKey(file.key);
    try {
      await apiFetch(`/files/mine/${file.source}/${file.id}`, { method: "DELETE" });
      setFiles((prev) => prev?.filter((f) => f.key !== file.key) ?? prev);
    } catch (err) {
      setError(localizedErrorMessage(err, t, "myFiles.deleteError"));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="stack">
      <div>
        <h1 style={{ marginBottom: 4 }}>{t("myFiles.title")}</h1>
        <p className="lede" style={{ margin: 0 }}>{t("myFiles.lede")}</p>
      </div>

      <div className="stack" style={{ gap: 10 }}>
        <label className="search-form">
          <SearchIcon size={18} />
          <span className="visually-hidden">{t("myFiles.search")}</span>
          <input type="search" value={query} placeholder={t("myFiles.search")} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="row" style={{ gap: 6 }} role="group" aria-label={t("myFiles.search")}>
          {KINDS.map((k) => (
            <button
              key={k.value || "all"}
              type="button"
              className={`chip${kind === k.value ? " selected" : ""}`}
              aria-pressed={kind === k.value}
              onClick={() => setKind(k.value)}
            >
              {t(k.label)}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {files === null && !error && <Loading />}
      {files?.length === 0 && <div className="empty-state">{t("myFiles.empty")}</div>}

      {files && files.length > 0 && (
        <ul className="file-list">
          {files.map((file) => {
            const src = `${API_URL}${file.downloadPath}`;
            const isImage = file.mimeType.startsWith("image/");
            return (
              <li key={file.key} className="file-row">
                <span className="file-thumb" aria-hidden="true">
                  {isImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={src} alt="" loading="lazy" />
                  ) : (
                    <FileIcon size={22} />
                  )}
                </span>
                <span className="file-meta">
                  <strong className="file-name">{file.name}</strong>
                  <span className="meta">
                    {[formatSize(file.sizeBytes), formatDate(file.createdAt, locale)].filter(Boolean).join(" · ")}
                  </span>
                  {file.product && (
                    <span className="meta">
                      {file.source === "post-cover"
                        ? t("myFiles.cover")
                        : file.source === "product-file"
                          ? t("myFiles.sold")
                          : t("myFiles.inPost")}{" "}
                      {file.product.deleted || !user ? (
                        <em>
                          {file.product.title} ({t("myFiles.deletedPost")})
                        </em>
                      ) : (
                        <Link className="text-link" href={postPathFor(user.username, file.product.id)}>
                          {file.product.title}
                        </Link>
                      )}
                    </span>
                  )}
                  {file.folder && (
                    <span className="meta">
                      {t("myFiles.inFolder")} {file.folder.title}
                    </span>
                  )}
                </span>
                <span className="file-actions">
                  <a
                    className="action-item is-icon"
                    href={src}
                    download={file.name}
                    aria-label={`${t("myFiles.download")}: ${file.name}`}
                    title={t("myFiles.download")}
                  >
                    <DownloadIcon size={17} />
                  </a>
                  {file.deletable ? (
                    <button
                      type="button"
                      className="action-item is-icon is-danger"
                      onClick={() => remove(file)}
                      disabled={busyKey === file.key}
                      aria-label={`${t("myFiles.delete")}: ${file.name}`}
                      title={t("myFiles.delete")}
                    >
                      <TrashIcon size={17} />
                    </button>
                  ) : (
                    <span className="meta file-sold-hint">{t("myFiles.soldHint")}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
