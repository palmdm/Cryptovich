"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiUpload, ApiError } from "@/lib/api";
import { uploadedImageSrc } from "@/lib/uploaded-image";
import { useLocale } from "@/components/locale-provider";
import { Loading } from "@/components/loading";
import { RichText } from "@/components/rich-text";
import { useImageEditor } from "@/components/image-editor";
import { useSession } from "@/components/session-provider";
import { SaleFields } from "@/components/sale-fields";
import { SalePrice } from "@/components/sale-price";
import { fromLocalInput, toLocalInput } from "@/lib/datetime-local";

interface Tier {
  id: string;
  name: string;
  description: string | null;
  currency: string;
  amountMinor: string;
  period: "MONTH" | "YEAR";
  status: "ACTIVE" | "ARCHIVED";
  imageUrl: string | null;
  discountPercent: number | null;
  discountEndsAt: string | null;
}

/** The decimal a price field shows: 250 → "2.50", 100 → "1". */
function decimal(amountMinor: string): string {
  const n = Number(amountMinor) / 100;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/**
 * Кабинет → «Уровни подписки»: making a tier, and changing one already
 * made — its name, what it offers (a list, as long as it needs), its price
 * and its picture. A new price applies to new subscriptions and renewals;
 * a period already paid for keeps the price it was paid at.
 */
export default function TiersPage() {
  const { t } = useLocale();
  const { user } = useSession();
  const [tiers, setTiers] = useState<Tier[] | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [priceDecimal, setPriceDecimal] = useState("");
  const [period, setPeriod] = useState<"MONTH" | "YEAR">("MONTH");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ tiers: Tier[] }>("/subscriptions/tiers/mine");
      setTiers(res.tiers);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("tiers.loadError"));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  async function createTier(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiFetch("/subscriptions/tiers", {
        method: "POST",
        body: JSON.stringify({ name, description: description || undefined, period, currency: "USD", priceDecimal }),
      });
      setName("");
      setDescription("");
      setPriceDecimal("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("tiers.createError"));
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive(tier: Tier) {
    setError(null);
    try {
      await apiFetch(`/subscriptions/tiers/${tier.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: tier.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE" }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("tiers.updateError"));
    }
  }

  return (
    <div className="stack">
      <h1>{t("tiers.title")}</h1>
      {error && <div className="error-banner">{error}</div>}

      {tiers === null && <Loading />}
      {tiers?.length === 0 && <div className="empty-state">{t("tiers.empty")}</div>}
      {tiers && tiers.length > 0 && (
        <div className="tier-admin-list">
          {tiers.map((tier) =>
            editing === tier.id ? (
              <TierEditor
                key={tier.id}
                tier={tier}
                onDone={async () => {
                  setEditing(null);
                  await load();
                }}
              />
            ) : (
              <article key={tier.id} className="card tier-admin">
                {tier.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="tier-image" src={uploadedImageSrc(tier.imageUrl) ?? undefined} alt="" loading="lazy" />
                )}
                <div className="tier-admin-head">
                  <strong>{tier.name}</strong>
                  <SalePrice
                    amountMinor={tier.amountMinor}
                    currency={tier.currency}
                    sale={tier}
                    suffix={` / ${t(tier.period === "MONTH" ? "common.perMonth" : "common.perYear")}`}
                  />
                </div>
                {tier.description && (
                  <div className="tier-description">
                    <RichText text={tier.description} creatorUsername={user?.username ?? ""} />
                  </div>
                )}
                <div className="row" style={{ gap: 8 }}>
                  <span className="status-pill">{t(tier.status === "ACTIVE" ? "tiers.active" : "tiers.archived")}</span>
                  <button className="secondary" onClick={() => setEditing(tier.id)}>
                    {t("tiers.edit")}
                  </button>
                  <button className="secondary" onClick={() => toggleArchive(tier)}>
                    {t(tier.status === "ACTIVE" ? "tiers.archive" : "tiers.reactivate")}
                  </button>
                </div>
              </article>
            ),
          )}
        </div>
      )}

      <form className="stack card" onSubmit={createTier}>
        <h2 style={{ margin: 0 }}>{t("tiers.new")}</h2>
        <div className="form-field">
          <label htmlFor="name">{t("common.name")}</label>
          <input id="name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="description">{t("common.description")}</label>
          <textarea id="description" rows={4} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("tiers.descriptionPlaceholder")} />
        </div>
        <div className="form-field">
          <label htmlFor="period">{t("tiers.billingPeriod")}</label>
          <select id="period" value={period} onChange={(e) => setPeriod(e.target.value as "MONTH" | "YEAR")}>
            <option value="MONTH">{t("tiers.monthly")}</option>
            <option value="YEAR">{t("tiers.yearly")}</option>
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="price">{t("tiers.priceUsd")}</label>
          <input id="price" required pattern="\d+(\.\d{1,2})?" value={priceDecimal} onChange={(e) => setPriceDecimal(e.target.value)} />
        </div>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? t("common.creating") : t("tiers.create")}
        </button>
      </form>
    </div>
  );
}

function TierEditor({ tier, onDone }: { tier: Tier; onDone: () => Promise<void> }) {
  const { t } = useLocale();
  const editor = useImageEditor();
  const [name, setName] = useState(tier.name);
  const [description, setDescription] = useState(tier.description ?? "");
  const [price, setPrice] = useState(decimal(tier.amountMinor));
  const [sale, setSale] = useState({ percent: tier.discountPercent ? String(tier.discountPercent) : "", endsAt: toLocalInput(tier.discountEndsAt) });
  const [imageUrl, setImageUrl] = useState(tier.imageUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/subscriptions/tiers/${tier.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          priceDecimal: price.trim(),
          discountPercent: sale.percent ? Number(sale.percent) : null,
          discountEndsAt: sale.percent ? fromLocalInput(sale.endsAt) : null,
        }),
      });
      await onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("tiers.updateError"));
    } finally {
      setBusy(false);
    }
  }

  async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    const file = await editor.edit(picked, { aspect: 16 / 9, maxSide: 1600, title: "imageEditor.tierTitle" });
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiUpload<{ tier: Tier }>(`/subscriptions/tiers/${tier.id}/image`, file);
      setImageUrl(res.tier.imageUrl);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("tiers.updateError"));
    } finally {
      setBusy(false);
    }
  }

  async function removeImage() {
    setBusy(true);
    try {
      await apiFetch(`/subscriptions/tiers/${tier.id}/image`, { method: "DELETE" });
      setImageUrl(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("tiers.updateError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack tier-admin" onSubmit={save}>
      {error && <div className="error-banner">{error}</div>}
      <div className="tier-image-field">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="tier-image" src={uploadedImageSrc(imageUrl) ?? undefined} alt="" />
        ) : (
          <div className="tier-image tier-image-empty">{t("tiers.noImage")}</div>
        )}
        <div className="row" style={{ gap: 8 }}>
          <label className="btn-secondary tier-image-pick">
            {imageUrl ? t("tiers.replaceImage") : t("tiers.addImage")}
            <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={pickImage} disabled={busy} hidden />
          </label>
          {imageUrl && (
            <button type="button" className="secondary" onClick={removeImage} disabled={busy}>
              {t("tiers.removeImage")}
            </button>
          )}
        </div>
      </div>
      <div className="form-field">
        <label htmlFor={`tier-name-${tier.id}`}>{t("common.name")}</label>
        <input id={`tier-name-${tier.id}`} required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="form-field">
        <label htmlFor={`tier-description-${tier.id}`}>{t("common.description")}</label>
        <textarea id={`tier-description-${tier.id}`} rows={6} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="form-field">
        <label htmlFor={`tier-price-${tier.id}`}>{t("tiers.price", { currency: tier.currency })}</label>
        <input id={`tier-price-${tier.id}`} required pattern="\d+(\.\d{1,2})?" value={price} onChange={(e) => setPrice(e.target.value)} />
        <span className="meta">{t("tiers.priceChangeHint")}</span>
      </div>
      <SaleFields percent={sale.percent} endsAt={sale.endsAt} onChange={setSale} />
      <div className="row" style={{ gap: 8 }}>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? t("common.saving") : t("common.save")}
        </button>
        <button type="button" className="secondary" onClick={() => void onDone()} disabled={busy}>
          {t("common.cancel")}
        </button>
      </div>
      {editor.element}
    </form>
  );
}
