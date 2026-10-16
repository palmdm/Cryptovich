"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { useSession } from "@/components/session-provider";
import type { ProductSummary } from "@/lib/types";
import { useLocale } from "@/components/locale-provider";
import { postPathFor } from "@platform/shared";

interface CreatedBundle {
  id: string;
  slug: string;
}

export default function NewBundlePage() {
  const { t } = useLocale();
  const { user } = useSession();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [priceDecimal, setPriceDecimal] = useState("");
  const [bundle, setBundle] = useState<CreatedBundle | null>(null);
  const [candidates, setCandidates] = useState<ProductSummary[]>([]);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<{ products: ProductSummary[] }>("/products/mine")
      .then((res) => setCandidates(res.products.filter((p) => p.type !== "BUNDLE" && p.status === "PUBLISHED")))
      .catch(() => setCandidates([]));
  }, []);

  async function createBundle(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { product } = await apiFetch<{ product: CreatedBundle }>("/products/bundles", {
        method: "POST",
        body: JSON.stringify({ title, currency: "USD", priceDecimal }),
      });
      setBundle(product);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("bundle.createError"));
    } finally {
      setBusy(false);
    }
  }

  async function toggleItem(productId: string) {
    if (!bundle) return;
    setError(null);
    try {
      if (addedIds.has(productId)) {
        await apiFetch(`/products/bundles/${bundle.id}/items/${productId}`, { method: "DELETE" });
        setAddedIds((prev) => {
          const next = new Set(prev);
          next.delete(productId);
          return next;
        });
      } else {
        await apiFetch(`/products/bundles/${bundle.id}/items`, {
          method: "POST",
          body: JSON.stringify({ itemProductId: productId }),
        });
        setAddedIds((prev) => new Set(prev).add(productId));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("bundle.updateError"));
    }
  }

  async function publish() {
    if (!bundle || addedIds.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/products/${bundle.id}/publish`, { method: "POST" });
      router.push(postPathFor(user?.username ?? "", bundle.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("bundle.publishError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <h1>{t("newBundle.title")}</h1>

      {!bundle && (
        <form className="stack card" onSubmit={createBundle}>
          {error && <div className="error-banner">{error}</div>}
          <div className="form-field">
            <label htmlFor="title">{t("common.title")}</label>
            <input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="form-field">
            <label htmlFor="price">{t("bundle.priceUsd")}</label>
            <input
              id="price"
              required
              pattern="\d+(\.\d{1,2})?"
              value={priceDecimal}
              onChange={(e) => setPriceDecimal(e.target.value)}
            />
          </div>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? t("common.creating") : t("bundle.create")}
          </button>
        </form>
      )}

      {bundle && (
        <div className="stack">
          {error && <div className="error-banner">{error}</div>}
          <p className="lede">{t("bundle.selectLede")}</p>
          {candidates.length === 0 && (
            <div className="empty-state">{t("bundle.noProducts")}</div>
          )}
          {candidates.length > 0 && (
            <div className="product-grid">
              {candidates.map((p) => (
                <label key={p.id} className="product-card" style={{ cursor: "pointer" }}>
                  <span className="badge">{p.type}</span>
                  <strong>{p.title}</strong>
                  <span className="checkbox-row">
                    <input type="checkbox" checked={addedIds.has(p.id)} onChange={() => toggleItem(p.id)} />
                    {t("bundle.inBundle")}
                  </span>
                </label>
              ))}
            </div>
          )}
          <button className="primary" onClick={publish} disabled={busy || addedIds.size === 0}>
            {busy ? "Publishing…" : `Publish bundle with ${addedIds.size} item${addedIds.size === 1 ? "" : "s"}`}
          </button>
        </div>
      )}
    </div>
  );
}
