"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { useLocale } from "./locale-provider";
import type { MyCategory, TaxonomyRef } from "@/lib/types";
import { Loading } from "@/components/loading";

/**
 * Author-side sections. A section disappears from the public page when it
 * has nothing *published* in it — not because it's broken, but because an
 * empty room isn't worth offering as a filter. Without a visible count
 * that behaviour reads as the feature silently not working: create a
 * section, assign a draft to it, and it never appears anywhere with no
 * explanation. Each chip below states both counts so the gap is visible
 * instead of silent.
 */
export function CategoryManager() {
  const { t } = useLocale();
  const [categories, setCategories] = useState<MyCategory[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setCategories((await apiFetch<{ categories: MyCategory[] }>("/categories/mine")).categories);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("taxonomy.loadError"));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/categories", { method: "POST", body: JSON.stringify({ name: name.trim() }) });
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("taxonomy.saveError"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await apiFetch(`/categories/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("taxonomy.saveError"));
    }
  }

  function status(c: MyCategory): string {
    if (c.publishedItems > 0) return t("taxonomy.postsLive", { count: c.publishedItems });
    if (c.totalItems > 0) return t("taxonomy.postsUnpublished", { count: c.totalItems });
    return t("taxonomy.postsNone");
  }

  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>{t("taxonomy.categories")}</h2>
      <p className="lede" style={{ margin: 0 }}>{t("taxonomy.categoriesHint")}</p>
      {error && <div className="error-banner">{error}</div>}

      <form className="row" style={{ gap: 8, alignItems: "flex-end" }} onSubmit={create}>
        <div className="form-field" style={{ flex: 1, minWidth: 200 }}>
          <label htmlFor="categoryName">{t("taxonomy.categoryName")}</label>
          <input id="categoryName" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? t("common.saving") : t("taxonomy.newCategory")}
        </button>
      </form>

      {categories === null && <Loading />}
      {categories?.length === 0 && <div className="empty-state">{t("taxonomy.noCategories")}</div>}
      {categories && categories.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          {categories.map((c) => (
            <div key={c.id} className="row" style={{ gap: 10, alignItems: "center", justifyContent: "space-between" }}>
              <span className="row" style={{ gap: 10, alignItems: "center" }}>
                <span className="chip">{c.name}</span>
                <span className={`meta${c.publishedItems === 0 ? " taxonomy-status-empty" : ""}`}>{status(c)}</span>
              </span>
              <button className="link-button" aria-label={`${t("common.delete")} ${c.name}`} onClick={() => remove(c.id)}>
                {t("common.delete")}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Assigns one post to sections and tags.
 *
 * `product` carries the post's *current* assignment (from the same
 * `/products/mine` call that lists it), which this pre-selects from. It
 * used to always open empty and fetch nothing about the specific post —
 * save from there PUTs the full set, so opening the editor and saving
 * without re-checking every box silently wiped whatever was already
 * assigned. There is no way to recover that from the API alone; the fix
 * is that the caller now has the data to pre-select correctly.
 */
export function PostTaxonomyEditor({
  productId,
  product,
  onSaved,
}: {
  productId: string;
  product: { categories?: TaxonomyRef[]; tags?: TaxonomyRef[] };
  onSaved?: () => void;
}) {
  const { t } = useLocale();
  const [categories, setCategories] = useState<TaxonomyRef[]>([]);
  const [selected, setSelected] = useState<string[]>(() => (product.categories ?? []).map((c) => c.id));
  const [tags, setTags] = useState(() => (product.tags ?? []).map((t) => t.name).join(", "));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ categories: TaxonomyRef[] }>("/categories/mine")
      .then((res) => !cancelled && setCategories(res.categories))
      .catch(() => !cancelled && setCategories([]));
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await apiFetch(`/products/${productId}/categories`, {
        method: "PUT",
        body: JSON.stringify({ categoryIds: selected }),
      });
      await apiFetch(`/products/${productId}/tags`, {
        method: "PUT",
        body: JSON.stringify({ tags: tags.split(",").map((x) => x.trim()).filter(Boolean) }),
      });
      setSaved(true);
      onSaved?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("taxonomy.saveError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      {error && <div className="error-banner">{error}</div>}

      {categories.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="meta">{t("taxonomy.categories")}</span>
          <div className="row" style={{ gap: 8 }}>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`chip${selected.includes(c.id) ? " selected" : ""}`}
                onClick={() => {
                  setSaved(false);
                  setSelected((prev) => (prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id]));
                }}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="form-field">
        <label htmlFor={`tags-${productId}`}>{t("taxonomy.tags")}</label>
        <input
          id={`tags-${productId}`}
          value={tags}
          onChange={(e) => {
            setSaved(false);
            setTags(e.target.value);
          }}
          placeholder="typescript, game dev"
        />
        <span className="meta">{t("taxonomy.tagsHint")}</span>
      </div>

      <div className="row" style={{ gap: 10, alignItems: "center" }}>
        <button className="secondary" type="button" onClick={save} disabled={busy} style={{ alignSelf: "flex-start" }}>
          {busy ? t("common.saving") : t("common.save")}
        </button>
        {saved && <span className="meta">{t("common.save")} ✓</span>}
      </div>
    </div>
  );
}
