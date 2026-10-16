"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, apiUpload, ApiError, type UploadPhase } from "@/lib/api";
import { UploadProgress } from "@/components/upload-progress";
import { useSession } from "@/components/session-provider";
import { useLocale } from "@/components/locale-provider";
import { uploadedImageSrc } from "@/lib/uploaded-image";
import { FrameWrap } from "@/components/avatar";
import { AvatarFramePicker } from "@/components/avatar-frame-picker";
import { PostTaxonomyEditor } from "@/components/taxonomy-editor";
import { ChatLinkSetting } from "@/components/chat-link-setting";
import { ProfileAboutSetting } from "@/components/profile-about-setting";
import { EngagementStatsModal } from "@/components/engagement-stats-modal";
import {
  FileTextIcon,
  PackageIcon,
  StickerIcon,
  CommentIcon,
  EyeIcon,
  ChevronDownIcon,
  TrashIcon,
  PencilIcon,
} from "@/components/icons";
import { formatMoney } from "@/lib/money";
import type { ProductSummary } from "@/lib/types";
import { isFrameValue, postPathFor } from "@platform/shared";
import { Loading } from "@/components/loading";
import { useImageEditor } from "@/components/image-editor";
import { SearchVisibilitySetting } from "@/components/search-visibility-setting";
import { StatusPill } from "@/components/status-pill";

const TYPE_ICON: Record<ProductSummary["type"], (props: { size?: number }) => React.ReactElement> = {
  POST: FileTextIcon,
  BUNDLE: PackageIcon,
  STICKER_PACK: StickerIcon,
  DIGITAL_FILE: PackageIcon,
};

function AvatarUploader() {
  const { t } = useLocale();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [frame, setFrame] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<UploadPhase | null>(null);
  const preview = useLocalPreview();
  const editor = useImageEditor();
  const { refresh } = useSession();

  useEffect(() => {
    apiFetch<{ creatorProfile: { avatarUrl: string | null; avatarFrame: string | null; displayName: string } }>("/creators/me")
      .then((res) => {
        setAvatarUrl(res.creatorProfile.avatarUrl);
        setName(res.creatorProfile.displayName);
        setFrame(isFrameValue(res.creatorProfile.avatarFrame) ? res.creatorProfile.avatarFrame : null);
      })
      .catch(() => {});
  }, []);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    // Placed and cropped first, as the circle it will be.
    const file = await editor.edit(picked, { aspect: 1, round: true, maxSide: 1024, title: "imageEditor.avatarTitle" });
    if (!file) return;
    setError(null);
    // The chosen picture shows at once, dimmed, while it uploads.
    preview.show(file);
    try {
      const res = await apiUpload<{ creatorProfile: { avatarUrl: string | null } }>("/creators/me/avatar", file, setPhase);
      setAvatarUrl(res.creatorProfile.avatarUrl);
      // The header shows the new picture at once.
      void refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("creator.avatarError"));
    } finally {
      setPhase(null);
      preview.clear();
    }
  }

  const shown = preview.url ?? (avatarUrl ? uploadedImageSrc(avatarUrl) : null);
  return (
    <div className="card stack" style={{ gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div className={phase ? "uploading-preview" : undefined}>
          <FrameWrap frame={frame} size="lg">
            {shown ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shown ?? undefined} alt={t("creator.avatarAlt")} className="avatar avatar-lg" />
            ) : (
              <div className="avatar avatar-lg" />
            )}
          </FrameWrap>
        </div>
        <div className="stack" style={{ gap: 6, flex: 1, minWidth: 0 }}>
          <strong>{t("creator.avatar")}</strong>
          {error && <span style={{ color: "var(--danger)", fontSize: "0.85rem" }}>{error}</span>}
          <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={handleFile} disabled={phase !== null} />
          <UploadProgress phase={phase} />
        </div>
      </div>
      <AvatarFramePicker avatarUrl={avatarUrl} name={name} value={frame} onChange={setFrame} />
      {editor.element}
    </div>
  );
}

/**
 * The file just chosen, as something an <img> can show before the server
 * has it. The object URL is released when the upload ends — without that,
 * every preview holds the whole image in memory for the life of the tab.
 */
function useLocalPreview() {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return {
    url,
    show: (file: File) => setUrl(file.type.startsWith("image/") ? URL.createObjectURL(file) : null),
    clear: () => setUrl(null),
  };
}

function CoverUploader() {
  const { t } = useLocale();
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<UploadPhase | null>(null);
  const preview = useLocalPreview();
  const editor = useImageEditor();

  useEffect(() => {
    apiFetch<{ creatorProfile: { coverUrl: string | null } }>("/creators/me")
      .then((res) => setCoverUrl(res.creatorProfile.coverUrl))
      .catch(() => {});
  }, []);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    // A banner: three times as wide as it is tall.
    const file = await editor.edit(picked, { aspect: 3, maxSide: 2400, title: "imageEditor.coverTitle" });
    if (!file) return;
    setError(null);
    setBusy(true);
    preview.show(file);
    try {
      const res = await apiUpload<{ creatorProfile: { coverUrl: string | null } }>("/creators/me/cover", file, setPhase);
      setCoverUrl(res.creatorProfile.coverUrl);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("creator.coverError"));
    } finally {
      setBusy(false);
      setPhase(null);
      preview.clear();
    }
  }

  async function remove() {
    setError(null);
    setBusy(true);
    try {
      await apiFetch("/creators/me/cover", { method: "DELETE" });
      setCoverUrl(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("creator.coverError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <strong>{t("creator.cover")}</strong>
      <span className="meta">{t("creator.coverHint")}</span>
      {error && <div className="error-banner">{error}</div>}
      {/* The same banner the public page shows, so what is previewed here
          is exactly what a reader sees. */}
      <div className={phase ? "uploading-preview" : undefined}>
        <div
          className="profile-cover"
          style={
            preview.url || coverUrl
              ? { backgroundImage: `url(${JSON.stringify(preview.url ?? (coverUrl ? uploadedImageSrc(coverUrl) : null) ?? "")})` }
              : undefined
          }
        />
      </div>
      <UploadProgress phase={phase} />
      <div className="row" style={{ gap: 8 }}>
        <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={handleFile} disabled={busy} />
        {coverUrl && (
          <button className="danger" onClick={remove} disabled={busy}>
            {t("creator.coverRemove")}
          </button>
        )}
      </div>
      {editor.element}
    </div>
  );
}

function BecomeCreatorForm({ onDone }: { onDone: () => void }) {
  const { t } = useLocale();
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiFetch("/creators", { method: "POST", body: JSON.stringify({ displayName, bio: bio || undefined }) });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("creator.createError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h2>{t("creator.becomeTitle")}</h2>
      <p className="lede">{t("creator.becomeLede")}</p>
      <form className="stack" onSubmit={handleSubmit}>
        {error && <div className="error-banner">{error}</div>}
        <div className="form-field">
          <label htmlFor="displayName">{t("creator.displayName")}</label>
          <input id="displayName" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="bio">{t("creator.bio")}</label>
          <textarea id="bio" rows={3} value={bio} onChange={(e) => setBio(e.target.value)} />
        </div>
        <button className="primary" type="submit" disabled={loading}>
          {loading ? t("creator.creating") : t("creator.create")}
        </button>
      </form>
    </div>
  );
}

function StickerPackPublishForm({ productId, onDone }: { productId: string; onDone: () => void }) {
  const { t } = useLocale();
  const [priceDecimal, setPriceDecimal] = useState("0");
  const [visibility, setVisibility] = useState<"PUBLIC" | "PURCHASED">("PUBLIC");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiFetch(`/products/stickers/${productId}/price`, {
        method: "PATCH",
        body: JSON.stringify({ visibility, currency: "USD", priceDecimal: visibility === "PURCHASED" ? priceDecimal : "0" }),
      });
      await apiFetch(`/products/${productId}/publish`, { method: "POST" });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("stickers.publishError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" style={{ gap: 6, marginTop: 8 }} onSubmit={handleSubmit}>
      {error && <div className="error-banner">{error}</div>}
      <select value={visibility} onChange={(e) => setVisibility(e.target.value as "PUBLIC" | "PURCHASED")}>
        <option value="PUBLIC">{t("stickers.freePublic")}</option>
        <option value="PURCHASED">{t("stickers.paid")}</option>
      </select>
      {visibility === "PURCHASED" && (
        <input placeholder={t("stickers.priceUsd")} pattern="\d+(\.\d{1,2})?" value={priceDecimal} onChange={(e) => setPriceDecimal(e.target.value)} />
      )}
      <button className="secondary" type="submit" disabled={busy}>
        {busy ? t("stickers.publishing") : t("stickers.setPricePublish")}
      </button>
    </form>
  );
}

export default function DashboardPage() {
  const { user, loading: sessionLoading, refresh } = useSession();
  const { t } = useLocale();
  const [products, setProducts] = useState<ProductSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Whether the account actually has a CreatorProfile row — not the same
  // thing as role. An ADMIN doesn't get one for free just by being an
  // admin, and previously this page assumed `role === "ADMIN"` meant
  // "isCreator", which sent it straight into loading /products/mine (and
  // every other creator-only endpoint) for an admin who'd never actually
  // created a profile, producing a page full of "You don't have
  // permission to do that." / "Creator could not be found." instead of
  // the normal "Become a creator" prompt every other role gets.
  const [isCreator, setIsCreator] = useState<boolean | null>(null);
  // Which post's Sections & tags panel is open — one at a time, so opening
  // a second doesn't leave a wall of expanded editors behind.
  const [expanded, setExpanded] = useState<string | null>(null);
  // Which post's engagement breakdown is open, if any.
  const [statsFor, setStatsFor] = useState<string | null>(null);
  // The post currently being deleted, so its row can show progress and
  // a double-click can't fire two deletes.
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    apiFetch("/creators/me")
      .then(() => setIsCreator(true))
      .catch(() => setIsCreator(false));
  }, [user]);

  const loadProducts = useCallback(async () => {
    try {
      const data = await apiFetch<{ products: ProductSummary[] }>("/products/mine");
      setProducts(data.products);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("dashboard.loadError"));
    }
  }, [t]);

  useEffect(() => {
    if (isCreator) loadProducts();
  }, [isCreator, loadProducts]);

  async function deletePost(product: ProductSummary) {
    if (!window.confirm(t("post.deleteConfirm", { title: product.title }))) return;
    setDeleting(product.id);
    setError(null);
    try {
      await apiFetch(`/products/${product.id}`, { method: "DELETE" });
      await loadProducts();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("post.deleteError"));
    } finally {
      setDeleting(null);
    }
  }

  if (sessionLoading || (user && isCreator === null)) return <Loading />;
  if (!user) return <p className="lede">{t("dashboard.signIn")}</p>;

  return (
    <div className="stack">
      <h1>{t("dashboard.title")}</h1>
      {!isCreator && (
        <BecomeCreatorForm
          onDone={() => {
            setIsCreator(true);
            refresh();
          }}
        />
      )}
      {isCreator && (
        <>
          <AvatarUploader />
          <CoverUploader />
          <ProfileAboutSetting />
          <ChatLinkSetting />
          <SearchVisibilitySetting />
          <div className="section-head">
            <h2>{t("dashboard.yourPosts")}</h2>
            <div className="button-row">
              <Link href="/dashboard/new-post" className="btn-primary">
                {t("dashboard.newPost")}
              </Link>
            </div>
          </div>
          {error && <div className="error-banner">{error}</div>}
          {products === null && <Loading />}
          {products?.length === 0 && (
            <div className="empty-state">{t("dashboard.empty")}</div>
          )}
          {products && products.length > 0 && (
            <div className="post-list">
              {products.map((p) => {
                const Icon = TYPE_ICON[p.type];
                const isOpen = expanded === p.id;
                const price = p.prices?.[0];
                const isPaid = price && price.pricingType !== "FREE";
                return (
                  <div key={p.id} className="post-row">
                    <div className="post-row-main">
                      <span className="post-row-icon">
                        <Icon size={19} />
                      </span>
                      <div className="post-row-body">
                        <div className="post-row-title-line">
                          {p.status === "PUBLISHED" ? (
                            <Link href={postPathFor(user.username, p.id)} className="post-row-title">
                              {p.title}
                            </Link>
                          ) : (
                            <span className="post-row-title">{p.title}</span>
                          )}
                          {isPaid && <span className="price-tag">{formatMoney(price!.amountMinor, price!.currency)}</span>}
                        </div>
                        <div className="post-row-meta">
                          {p.status && <StatusPill prefix="product.status" status={p.status} />}
                          <button
                            type="button"
                            className="post-row-stat post-row-stat-button"
                            onClick={() => setStatsFor(p.id)}
                            title={t("stats.view")}
                          >
                            <EyeIcon size={14} /> {p.viewCount ?? 0}
                          </button>
                          <span className="post-row-stat">
                            <CommentIcon size={14} /> {p.commentCount ?? 0}
                          </span>
                          {(p.reactionCount ?? 0) > 0 && (
                            <span className="post-row-stat">
                              <span className="reaction-emoji">❤️</span> {p.reactionCount}
                            </span>
                          )}
                          {(p.categories?.length ?? 0) > 0 && (
                            <span className="meta">{p.categories!.map((c) => c.name).join(", ")}</span>
                          )}
                        </div>
                      </div>
                      <div className="post-row-actions">
                        {p.type === "STICKER_PACK" && p.status === "DRAFT" ? (
                          <StickerPackPublishForm productId={p.id} onDone={loadProducts} />
                        ) : p.status === "DRAFT" ? (
                          <button
                            className="secondary"
                            onClick={async () => {
                              await apiFetch(`/products/${p.id}/publish`, { method: "POST" });
                              await loadProducts();
                            }}
                          >
                            {t("dashboard.publish")}
                          </button>
                        ) : (
                          <Link href={postPathFor(user.username, p.id)} className="btn-secondary">
                            {t("dashboard.view")}
                          </Link>
                        )}
                        <button
                          className={`post-row-toggle${isOpen ? " is-open" : ""}`}
                          onClick={() => setExpanded(isOpen ? null : p.id)}
                          aria-expanded={isOpen}
                        >
                          {t("dashboard.sectionsAndTags")}
                          <ChevronDownIcon size={16} />
                        </button>
                        <Link href={`/dashboard/posts/${p.id}/edit`} className="post-row-toggle">
                          <PencilIcon size={16} />
                          {t("post.edit")}
                        </Link>
                        <button
                          className="post-row-toggle is-danger"
                          onClick={() => deletePost(p)}
                          disabled={deleting === p.id}
                          title={t("post.delete")}
                        >
                          <TrashIcon size={16} />
                          {deleting === p.id ? t("post.deleting") : t("post.delete")}
                        </button>
                      </div>
                    </div>
                    {isOpen && (
                      <div className="post-row-expand">
                        <PostTaxonomyEditor productId={p.id} product={p} onSaved={loadProducts} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {statsFor && <EngagementStatsModal productId={statsFor} onClose={() => setStatsFor(null)} />}

        </>
      )}
    </div>
  );
}
