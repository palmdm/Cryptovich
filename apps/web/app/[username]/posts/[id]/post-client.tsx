"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError, API_URL, localizedErrorMessage } from "@/lib/api";
import { useSession } from "@/components/session-provider";
import { useAuthPrompt } from "@/components/auth-prompt";
import { Avatar } from "@/components/avatar";
import { CommentThread } from "@/components/comment-thread";
import { ShareButton } from "@/components/share-button";
import { PayoutAddressList, type PayoutWallet } from "@/components/payout-addresses";
import { RichText } from "@/components/rich-text";
import { ReactionBar, type ReactionSummary } from "@/components/reaction-bar";
import { EngagementStatsModal } from "@/components/engagement-stats-modal";
import { CommentIcon, EyeIcon, TrashIcon, PencilIcon } from "@/components/icons";
import { embeddedNames, postPathFor, safeHttpUrl } from "@platform/shared";
import { formatMoney } from "@/lib/money";
import { useLocale } from "@/components/locale-provider";
import type { ProductSummary, AccessDecision, BundleDetail } from "@/lib/types";
import { PinButton } from "@/components/pin-button";
import { LockedPreview } from "@/components/locked-preview";
import { ImageGallery } from "@/components/image-gallery";
import { BookmarkButton } from "@/components/bookmark-button";
import { formatDate } from "@/lib/dates";
import { Loading } from "@/components/loading";
import { StatusPill } from "@/components/status-pill";
import { ReportButton } from "@/components/report-button";
import { GoalProgress, type Goal } from "@/components/fundraising-goal";
import { saleText } from "@/components/sale-price";

interface StickerItem {
  id: string;
  name: string;
  kind: string;
  url: string;
}

interface Attachment {
  id: string;
  kind: "IMAGE" | "VIDEO" | "AUDIO" | "FILE";
  mimeType: string;
  sizeBytes: number;
  originalFilename: string;
  altText: string | null;
  url: string;
}

interface CreatorPublicProfile {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  avatarFrame?: string | null;
}

interface DigitalFileInfo {
  originalFilename: string;
  mimeType: string;
  sizeBytes: string;
  checksumSha256: string;
  url: string | null;
}

interface ProductDetailResponse {
  // The author's current username — differs from the URL's :username
  // when this post was reached through a pre-rename link.
  creatorUsername: string;
  product: ProductSummary;
  access: AccessDecision;
  reactions: ReactionSummary;
  bookmarked: boolean;
  content: string | null;
  attachments: Attachment[];
  bundle: BundleDetail | null;
  stickers: StickerItem[];
  file: DigitalFileInfo | null;
}

function AttachmentView({ attachment }: { attachment: Attachment }) {
  const src = `${API_URL}${attachment.url}`;
  if (attachment.kind === "VIDEO") {
    return <video src={src} controls style={{ maxWidth: "100%", borderRadius: 10 }} />;
  }
  if (attachment.kind === "AUDIO") {
    return <audio src={src} controls style={{ width: "100%" }} />;
  }
  return (
    <a className="btn-secondary" href={src} download={attachment.originalFilename}>
      Download {attachment.originalFilename} ({(attachment.sizeBytes / 1024).toFixed(0)} KB)
    </a>
  );
}

interface Payment {
  id: string;
  status: string;
}

/** What unlocking costs — with the author's sale applied, as the checkout will charge. */
function formatPrice(price: ProductSummary["prices"][number] | undefined, freeLabel: string, product: ProductSummary) {
  if (!price || price.pricingType === "FREE") return freeLabel;
  return saleText(price.amountMinor, price.currency, { discountPercent: product.discountPercent ?? null, discountEndsAt: product.discountEndsAt ?? null });
}


/**
 * `ref` is the post's id — its address today, `/<author>/posts/<id>` — or
 * the slug an older `/<author>/p/<slug>` link carries. Either loads it;
 * the browser then moves on to the one canonical address.
 */
export function ProductView({ params }: { params: { username: string; ref: string } }) {
  const router = useRouter();
  const { user } = useSession();
  const { requireAccount } = useAuthPrompt();
  const { t, locale } = useLocale();
  const [data, setData] = useState<ProductDetailResponse | null>(null);
  const [creator, setCreator] = useState<CreatorPublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [manualInstructions, setManualInstructions] = useState<string | null>(null);
  const [wallets, setWallets] = useState<PayoutWallet[]>([]);
  const [busy, setBusy] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  // The author clicking their own view count opens the breakdown.
  const [statsOpen, setStatsOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<ProductDetailResponse>(`/store/${params.username}/${params.ref}`);
      // A link by slug, or from before the author renamed: move the
      // browser to the one canonical address instead of rendering here.
      if (res.creatorUsername !== params.username || res.product.id !== params.ref) {
        router.replace(postPathFor(res.creatorUsername, res.product.id));
        return;
      }
      setData(res);
      setBookmarked(res.bookmarked);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("post.loadError"));
    }
  }, [params.username, params.ref, t, router]);

  async function deletePost() {
    if (!data) return;
    if (!window.confirm(t("post.deleteConfirm", { title: data.product.title }))) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/products/${data.product.id}`, { method: "DELETE" });
      // The post no longer exists publicly, so staying on its page would
      // just render a 404 — go back to the author's page instead.
      router.replace(`/${params.username}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("post.deleteError"));
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ wallets: PayoutWallet[] }>(`/wallets/${params.username}`)
      .then((res) => !cancelled && setWallets(res.wallets))
      .catch(() => !cancelled && setWallets([]));
    return () => {
      cancelled = true;
    };
  }, [params.username]);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ creator: CreatorPublicProfile }>(`/creators/${params.username}`)
      .then((res) => !cancelled && setCreator(res.creator))
      .catch(() => !cancelled && setCreator(null));
    return () => {
      cancelled = true;
    };
  }, [params.username]);

  async function markPaid() {
    if (!payment) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ payment: Payment }>(`/payments/${payment.id}/mark-paid`, { method: "POST" });
      setPayment(res.payment);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("tip.markPaidError"));
    } finally {
      setBusy(false);
    }
  }

  async function startCheckout() {
    // The same button signed out; buying is an account's.
    if (!data || !requireAccount()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ payment: Payment; manualInstructions: string | null }>("/payments/checkout", {
        method: "POST",
        body: JSON.stringify({ productId: data.product.id }),
      });
      setPayment(res.payment);
      setManualInstructions(res.manualInstructions);
    } catch (err) {
      setError(localizedErrorMessage(err, t, "post.checkoutError"));
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <div className="error-banner">{error}</div>;
  if (!data) return <Loading />;

  const { product, access, content, bundle, stickers, file } = data;
  // Files the author placed in the text are drawn there; the rest below it.
  const placed = new Set(content ? embeddedNames(content) : []);
  const loose = data.attachments.filter((a) => !placed.has(a.originalFilename));
  const price = product.prices[0];
  const postPath = postPathFor(params.username, product.id);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <article className="feed-card post-full" style={{ padding: "20px 22px", gap: 14 }}>
        <div className="feed-card-head">
          <Link href={`/${params.username}`} className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
            <Avatar url={creator?.avatarUrl} name={creator?.displayName ?? params.username} frame={creator?.avatarFrame} size="sm" />
            <span>
              <span style={{ display: "block", fontWeight: 600, fontSize: "0.92rem" }}>
                {creator?.displayName ?? `@${params.username}`}
              </span>
              <span className="meta">{formatDate(product.publishedAt, locale)}</span>
            </span>
          </Link>
        </div>

        <h1>{product.title}</h1>
        {product.description && <p className="lede">{product.description}</p>}

        {error && <div className="error-banner">{error}</div>}

        {bundle && (
          <div className="stack" style={{ gap: 12 }}>
            {bundle.pricing && (
              <div className="row" style={{ gap: 18 }}>
                <span className="meta">
                  {t("post.individualValue")} <strong>{formatMoney(bundle.pricing.individualValueMinor, bundle.pricing.currency)}</strong>
                </span>
                <span className="meta">
                  {t("post.bundlePrice")} <strong>{formatMoney(bundle.pricing.bundlePriceMinor, bundle.pricing.currency)}</strong>
                </span>
                <span className="amount-positive">
                  {t("post.youSave")} {formatMoney(bundle.pricing.savingsMinor, bundle.pricing.currency)}
                </span>
              </div>
            )}
            {user && bundle.ownedCount > 0 && (
              <p className="meta">
                {t("post.ownsBundleItems", { owned: bundle.ownedCount, total: bundle.totalCount })}
              </p>
            )}
            <div className="product-grid">
              {bundle.items.map((item) => (
                <Link key={item.id} href={postPathFor(params.username, item.id)} className="product-card">
                  <strong>{item.title}</strong>
                  {item.owned && <span className="status-pill">{t("post.owned")}</span>}
                </Link>
              ))}
            </div>
          </div>
        )}

        {access.allowed && (
          <div className="stack" style={{ gap: 14 }}>
            {/* RichText emits its own blocks (paragraphs, lists, code),
                so it is not wrapped in a <p> — that would nest them. */}
            {content && <RichText text={content} creatorUsername={params.username} attachments={data.attachments} />}
            {!content && bundle && <p>{t("post.bundleUnlocked")}</p>}
            {loose.length > 0 && (
              <div className="stack" style={{ gap: 12 }}>
                {/* The files not placed in the text: every picture in one
                    block that opens in the viewer; video, audio and files
                    keep their own players. */}
                <ImageGallery
                  variant="full"
                  images={loose.filter((a) => a.kind === "IMAGE").map((a) => ({ url: a.url, alt: a.altText ?? a.originalFilename }))}
                />
                {loose
                  .filter((a) => a.kind !== "IMAGE")
                  .map((a) => (
                    <AttachmentView key={a.id} attachment={a} />
                  ))}
              </div>
            )}
            {file && (
              <div className="card stack" style={{ gap: 8, padding: 14 }}>
                <strong>{file.originalFilename}</strong>
                <span className="meta">
                  {(Number(file.sizeBytes) / 1024).toFixed(0)} KB · {t("files.checksum")} {file.checksumSha256.slice(0, 16)}…
                </span>
                {file.url && (
                  <a className="btn-primary" href={`${API_URL}${file.url}`} style={{ width: "fit-content" }}>
                    {t("files.download")}
                  </a>
                )}
              </div>
            )}
            {product.type === "STICKER_PACK" && (
              <div className="product-grid">
                {stickers.map((s) => (
                  <div key={s.id} className="product-card" style={{ alignItems: "center" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={safeHttpUrl(s.url) ?? undefined} alt={s.name} style={{ maxWidth: "100%", maxHeight: 96 }} />
                    <span style={{ fontSize: "0.85rem" }}>{s.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!access.allowed && (
          <LockedPreview
            product={product}
            onOpen={() => document.getElementById("unlock")?.scrollIntoView({ behavior: "smooth", block: "center" })}
          />
        )}

        {/* Free on every post — a locked post gets the same bar as an
            open one, because reacting reveals nothing about the content. */}
        <ReactionBar productId={product.id} initial={data.reactions} />

        <div className="action-bar">
          <span className="action-item">
            <CommentIcon size={17} />
            {product.commentCount ?? 0}
          </span>
          <ShareButton path={postPath} />
          <BookmarkButton productId={product.id} initial={bookmarked} />
          {access.reason !== "OWNER" && <ReportButton target="PRODUCT" id={product.id} variant="icon" />}
          {access.reason === "OWNER" && product.status !== "DRAFT" && (
            <PinButton
              productId={product.id}
              pinned={Boolean(product.pinned)}
              onChange={(pinned) => setData((prev) => (prev ? { ...prev, product: { ...prev.product, pinned } } : prev))}
              onError={setError}
            />
          )}
          {/* The author's own copy of the post is where deleting it
              belongs — the dashboard row has the same control. */}
          {access.reason === "OWNER" && (
            <Link
              href={`/dashboard/posts/${product.id}/edit`}
              className="action-item is-icon"
              aria-label={t("post.edit")}
              title={t("post.edit")}
            >
              <PencilIcon size={17} />
            </Link>
          )}
          {access.reason === "OWNER" && (
            <button
              type="button"
              className="action-item is-icon is-danger"
              onClick={deletePost}
              disabled={busy}
              aria-label={busy ? t("post.deleting") : t("post.delete")}
              title={t("post.delete")}
            >
              <TrashIcon size={17} />
            </button>
          )}
          {typeof product.viewCount === "number" &&
            // Only the author has stats to see — /products/:id/stats is
            // owner-only, so for everyone else this stays a plain count.
            (access.reason === "OWNER" ? (
              <button
                type="button"
                className="action-views is-button"
                onClick={() => setStatsOpen(true)}
                title={t("stats.view")}
              >
                <EyeIcon size={17} />
                {product.viewCount}
              </button>
            ) : (
              <span className="action-views">
                <EyeIcon size={17} />
                {product.viewCount}
              </span>
            ))}
        </div>
      </article>

      {statsOpen && <EngagementStatsModal productId={product.id} onClose={() => setStatsOpen(false)} />}

      {!access.allowed && product.visibility === "GOAL" && (
        // Nothing to buy: the post opens for everyone once the goal is met,
        // so the way to open it is to help the author get there.
        <div id="unlock" className="card stack" style={{ gap: 12 }}>
          <p>{t("post.goalLocked")}</p>
          {product.requiredGoal && "percent" in product.requiredGoal ? (
            <GoalProgress goal={product.requiredGoal as Goal} />
          ) : (
            <p className="meta">{t("lock.goalGone")}</p>
          )}
          <Link href={`/${params.username}`} className="btn-primary" style={{ width: "fit-content" }}>
            {t("post.supportAuthor")}
          </Link>
        </div>
      )}

      {!access.allowed && product.visibility !== "GOAL" && (
        <div id="unlock" className="card stack" style={{ gap: 12 }}>
          {!payment && (
            <>
              <p>{t("post.buyOnce")}</p>
              <button className="primary" onClick={startCheckout} disabled={busy} style={{ width: "fit-content" }}>
                {busy ? t("post.starting") : `${t("post.unlockFor")} ${formatPrice(price, t("common.free"), product)}`}
              </button>
            </>
          )}
          {payment && (
            <>
              <StatusPill prefix="payments.status" status={payment.status} />
              {payment.status === "AWAITING_PAYMENT" && (
                <div className="stack" style={{ gap: 8 }}>
                  {manualInstructions && <p style={{ whiteSpace: "pre-wrap" }}>{manualInstructions}</p>}
                  <PayoutAddressList wallets={wallets} />
                  <button className="secondary" onClick={markPaid} disabled={busy} style={{ width: "fit-content" }}>
                    {t("tip.iveSentIt")}
                  </button>
                </div>
              )}
              {["AWAITING_PAYMENT", "DETECTED", "CONFIRMING"].includes(payment.status) && (
                <p className="meta">{t("tip.markedPaid")}</p>
              )}
              {payment.status === "CONFIRMED" && <p>{t("post.confirmed")}</p>}
              {payment.status === "FAILED" && <p>{t("post.failed")}</p>}
            </>
          )}
        </div>
      )}

      {access.allowed && <CommentThread productId={product.id} creatorUsername={params.username} />}
    </div>
  );
}
