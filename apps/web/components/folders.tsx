"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, apiUpload, ApiError, API_URL, localizedErrorMessage, type UploadPhase } from "@/lib/api";
import { UploadProgress } from "./upload-progress";
import { useLocale } from "./locale-provider";
import { safeHttpUrl, postPathFor } from "@platform/shared";
import { formatMoney } from "@/lib/money";
import { FolderIcon, LinkIcon, FileTextIcon, LockIcon, TrashIcon, PlusIcon } from "./icons";
import type { ProductSummary } from "@/lib/types";
import { Loading } from "@/components/loading";

export interface FolderSummary {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  itemCount: number;
}

export interface FolderItem {
  id: string;
  kind: "PRODUCT" | "UPLOAD" | "LINK";
  label: string | null;
  url: string | null;
  downloadUrl: string | null;
  originalFilename: string | null;
  sizeBytes: string | null;
  product: ProductSummary | null;
}

function formatSize(bytes: string | null): string {
  if (!bytes) return "";
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** The folder list on an author's public page. Renders nothing when empty. */
export function FolderList({ username }: { username: string }) {
  const { t } = useLocale();
  const [folders, setFolders] = useState<FolderSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ folders: FolderSummary[] }>(`/creators/${username}/folders`)
      .then((res) => !cancelled && setFolders(res.folders))
      .catch(() => !cancelled && setFolders([]));
    return () => {
      cancelled = true;
    };
  }, [username]);

  if (folders.length === 0) return null;

  return (
    <div className="stack" style={{ gap: 10 }}>
      <h2>{t("folders.title")}</h2>
      <div className="product-grid">
        {folders.map((folder) => (
          <Link key={folder.id} href={`/${username}/f/${folder.slug}`} className="product-card">
            <span className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
              <FolderIcon size={18} />
              <strong>{folder.title}</strong>
            </span>
            {folder.description && <span className="meta">{folder.description}</span>}
            <span className="meta">{t("folders.items", { count: folder.itemCount })}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/**
 * One item inside a folder. A product keeps its own gating — this only
 * links to it, and the post page asks EntitlementService as usual.
 */
export function FolderItemRow({ item, username }: { item: FolderItem; username: string }) {
  const { t } = useLocale();

  if (item.kind === "PRODUCT" && item.product) {
    const p = item.product;
    const locked = p.visibility !== "PUBLIC";
    const price = p.prices?.[0];
    return (
      <Link href={postPathFor(username, p.id)} className="folder-item">
        <span className="folder-item-icon">{locked ? <LockIcon size={17} /> : <FileTextIcon size={17} />}</span>
        <span className="folder-item-body">
          <strong>{p.title}</strong>
          {p.description && <span className="meta">{p.description}</span>}
        </span>
        {locked && (
          <span className="price-tag">
            {price && price.pricingType !== "FREE" ? formatMoney(price.amountMinor, price.currency) : t("common.free")}
          </span>
        )}
      </Link>
    );
  }

  // Re-checked here, not only when the link was saved: a row can predate
  // the server's http/https rule, and a `javascript:` href would run in
  // this page for whoever clicked it. An unsafe link is shown, not linked.
  const safeUrl = item.kind === "LINK" ? safeHttpUrl(item.url) : null;
  if (item.kind === "LINK" && item.url && !safeUrl) {
    return (
      <div className="folder-item">
        <span className="folder-item-icon">
          <LinkIcon size={17} />
        </span>
        <span className="folder-item-body">
          <strong>{item.label}</strong>
          <span className="meta">{item.url}</span>
        </span>
      </div>
    );
  }

  if (item.kind === "LINK" && safeUrl) {
    return (
      <a className="folder-item" href={safeUrl} target="_blank" rel="noreferrer noopener">
        <span className="folder-item-icon">
          <LinkIcon size={17} />
        </span>
        <span className="folder-item-body">
          <strong>{item.label}</strong>
          <span className="meta">{item.url}</span>
        </span>
      </a>
    );
  }

  if (item.kind === "UPLOAD" && item.downloadUrl) {
    return (
      <a className="folder-item" href={`${API_URL}${item.downloadUrl}`}>
        <span className="folder-item-icon">
          <FileTextIcon size={17} />
        </span>
        <span className="folder-item-body">
          <strong>{item.label ?? item.originalFilename}</strong>
          <span className="meta">{formatSize(item.sizeBytes)}</span>
        </span>
        <span className="meta">{t("folders.download")}</span>
      </a>
    );
  }

  return null;
}

/** Author-side create/fill/delete. */
export function FolderManager({ canUpload, username }: { canUpload: boolean; username: string }) {
  const { t } = useLocale();
  const [folders, setFolders] = useState<FolderSummary[] | null>(null);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [title, setTitle] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase | null>(null);
  const [items, setItems] = useState<FolderItem[]>([]);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setFolders((await apiFetch<{ folders: FolderSummary[] }>("/folders/mine")).folders);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("folders.loadError"));
    }
  }, [t]);

  useEffect(() => {
    load();
    apiFetch<{ products: ProductSummary[] }>("/products/mine")
      .then((res) => setProducts(res.products))
      .catch(() => setProducts([]));
  }, [load]);

  const openFolder = useCallback(async (folder: FolderSummary) => {
    setOpenId(folder.id);
    try {
      const res = await apiFetch<{ folder: { items: FolderItem[] } }>(`/creators/${username}/folders/${folder.slug}`);
      setItems(res.folder.items);
    } catch {
      setItems([]);
    }
  }, [username]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/folders", { method: "POST", body: JSON.stringify({ title }) });
      setTitle("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("folders.saveError"));
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("folders.saveError"));
    }
  }

  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>{t("folders.title")}</h2>
      <p className="lede" style={{ margin: 0 }}>{t("folders.lede")}</p>
      {error && <div className="error-banner">{error}</div>}

      <form className="row" style={{ gap: 8, alignItems: "flex-end" }} onSubmit={create}>
        <div className="form-field" style={{ flex: 1, minWidth: 200 }}>
          <label htmlFor="folder-title">{t("folders.name")}</label>
          <input id="folder-title" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? t("common.creating") : t("folders.create")}
        </button>
      </form>

      {folders === null && <Loading />}
      {folders?.length === 0 && <div className="empty-state">{t("folders.empty")}</div>}

      {folders?.map((folder) => (
        <div key={folder.id} className="stack" style={{ gap: 8 }}>
          <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
            <span className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
              <FolderIcon size={17} />
              <strong>{folder.title}</strong>
              <span className="meta">{t("folders.items", { count: folder.itemCount })}</span>
            </span>
            <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
              <button
                className="secondary"
                onClick={() => (openId === folder.id ? setOpenId(null) : openFolder(folder))}
              >
                {t("folders.open")}
              </button>
              <button
                className="danger"
                onClick={() => {
                  if (!window.confirm(t("folders.deleteConfirm", { title: folder.title }))) return;
                  act(() => apiFetch(`/folders/${folder.id}`, { method: "DELETE" }));
                }}
              >
                <TrashIcon size={15} />
              </button>
            </span>
          </div>

          {openId === folder.id && (
            <div className="folder-editor stack" style={{ gap: 10 }}>
              {/* Add an existing post */}
              <div className="form-field">
                <label htmlFor={`add-${folder.id}`}>{t("folders.addPost")}</label>
                <select
                  id={`add-${folder.id}`}
                  defaultValue=""
                  onChange={(e) => {
                    const productId = e.target.value;
                    e.target.value = "";
                    if (!productId) return;
                    act(() =>
                      apiFetch(`/folders/${folder.id}/items`, {
                        method: "POST",
                        body: JSON.stringify({ kind: "PRODUCT", productId }),
                      }),
                    );
                  }}
                >
                  <option value="">—</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </div>

              {/* Add a link */}
              <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
                <div className="form-field" style={{ flex: 2, minWidth: 180 }}>
                  <label htmlFor={`url-${folder.id}`}>{t("folders.linkUrl")}</label>
                  <input
                    id={`url-${folder.id}`}
                    type="url"
                    placeholder="https://…"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                  />
                </div>
                <div className="form-field" style={{ flex: 1, minWidth: 140 }}>
                  <label htmlFor={`label-${folder.id}`}>{t("folders.linkLabel")}</label>
                  <input id={`label-${folder.id}`} value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} />
                </div>
                <button
                  className="secondary"
                  disabled={!linkUrl || !linkLabel}
                  onClick={() =>
                    act(async () => {
                      await apiFetch(`/folders/${folder.id}/items`, {
                        method: "POST",
                        body: JSON.stringify({ kind: "LINK", url: linkUrl, label: linkLabel }),
                      });
                      setLinkUrl("");
                      setLinkLabel("");
                    })
                  }
                >
                  <PlusIcon size={15} /> {t("folders.addLink")}
                </button>
              </div>

              {/* Upload a file — the same privilege every other upload needs. */}
              {canUpload ? (
                <div className="form-field">
                  <label htmlFor={`file-${folder.id}`}>{t("folders.addFile")}</label>
                  <input
                    id={`file-${folder.id}`}
                    type="file"
                    disabled={uploadPhase !== null}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      setError(null);
                      try {
                        await apiUpload(`/folders/${folder.id}/uploads`, file, setUploadPhase);
                        await load();
                      } catch (err) {
                        setError(localizedErrorMessage(err, t, "folders.saveError"));
                      } finally {
                        setUploadPhase(null);
                      }
                    }}
                  />
                  <UploadProgress phase={uploadPhase} />
                </div>
              ) : (
                <span className="meta">{t("folders.uploadLocked")}</span>
              )}

              {items.length > 0 && (
                <div className="stack" style={{ gap: 6 }}>
                  {items.map((item) => (
                    <div key={item.id} className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                      <span className="meta">{item.product?.title ?? item.label}</span>
                      <button
                        className="icon-button"
                        onClick={() => act(() => apiFetch(`/folders/${folder.id}/items/${item.id}`, { method: "DELETE" }))}
                        aria-label={t("common.delete")}
                      >
                        <TrashIcon size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
