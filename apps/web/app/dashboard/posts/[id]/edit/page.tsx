"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { useSession } from "@/components/session-provider";
import { useLocale } from "@/components/locale-provider";
import { PostEditor } from "@/components/post-editor";
import { PostCoverField } from "@/components/post-cover-field";
import { postPathFor } from "@platform/shared";
import { Loading } from "@/components/loading";
import { overLimit, usePostLimit } from "@/components/length-ring";
import { toLocalInput } from "@/lib/datetime-local";
import { OPEN_ACCESS, PostAccessFields, accessBody, accessReady, type PostAccess, type PostVisibility } from "@/components/post-access-fields";

interface EditableProduct {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  visibility: PostVisibility;
  requiredTierId: string | null;
  requiredGoalId: string | null;
  discountPercent: number | null;
  discountEndsAt: string | null;
  prices: { amountMinor: string; currency: string; pricingType: string }[];
  post: { content: string } | null;
  coverUrl: string | null;
}

/** Minor units back to the decimal string the form edits. */
function toDecimal(amountMinor: string | undefined): string {
  if (!amountMinor) return "0";
  const n = BigInt(amountMinor);
  return `${n / 100n}.${(n % 100n).toString().padStart(2, "0")}`;
}

export default function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t } = useLocale();
  const { user } = useSession();
  const router = useRouter();
  const [product, setProduct] = useState<EditableProduct | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const maxChars = usePostLimit();
  const [description, setDescription] = useState("");
  const [access, setAccess] = useState<PostAccess>(OPEN_ACCESS);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ product: EditableProduct }>(`/products/mine/${id}`);
      const p = res.product;
      setProduct(p);
      setTitle(p.title);
      setContent(p.post?.content ?? "");
      setDescription(p.description ?? "");
      setAccess({
        visibility: p.visibility,
        priceDecimal: toDecimal(p.prices[0]?.amountMinor),
        requiredTierId: p.requiredTierId ?? "",
        requiredGoalId: p.requiredGoalId ?? "",
        discountPercent: p.discountPercent ? String(p.discountPercent) : "",
        discountEndsAt: toLocalInput(p.discountEndsAt),
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("editPost.loadError"));
    }
  }, [id, t]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await apiFetch(`/products/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title,
          content,
          description: description.trim() || null,
          ...accessBody(access, null),
        }),
      });
      setSaved(true);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("editPost.saveError"));
    } finally {
      setBusy(false);
    }
  }

  if (error && !product) return <div className="error-banner">{error}</div>;
  if (!product) return <Loading />;

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>{t("editPost.title")}</h1>
        <Link href={postPathFor(user?.username ?? "", product.id)} className="btn-secondary">
          {t("editPost.viewPost")}
        </Link>
      </div>

      <form className="stack card" onSubmit={handleSubmit}>
        {error && <div className="error-banner">{error}</div>}
        <div className="form-field">
          <label htmlFor="title">{t("common.title")}</label>
          <input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} />
          <span className="meta">{t("editPost.slugNote")}</span>
        </div>
        <div className="form-field">
          <label htmlFor="content">{t("form.content")}</label>
          <PostEditor value={content} onChange={setContent} previewAs={user?.username ?? ""} />
        </div>
        <div className="form-field">
          <label htmlFor="description">{t("common.description")}</label>
          <input id="description" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <PostAccessFields value={access} onChange={setAccess} />
        {access.visibility !== "PUBLIC" && (
          <PostCoverField
            productId={product.id}
            coverUrl={product.coverUrl}
            onSaved={(coverUrl) => setProduct((prev) => (prev ? { ...prev, coverUrl } : prev))}
          />
        )}
        <div className="row" style={{ gap: 10 }}>
          <button className="primary" type="submit" disabled={busy || !accessReady(access) || overLimit(content, maxChars)}>
            {busy ? t("common.saving") : t("editPost.save")}
          </button>
          {saved && <span className="lede">{t("editPost.saved")}</span>}
          <button type="button" className="secondary" onClick={() => router.push("/dashboard")}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </div>
  );
}
