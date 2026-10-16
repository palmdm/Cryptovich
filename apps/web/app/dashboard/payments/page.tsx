"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { useSession } from "@/components/session-provider";
import { formatMoney } from "@/lib/money";
import { useLocale } from "@/components/locale-provider";
import { PayoutAddressManager } from "@/components/payout-addresses";
import { Loading } from "@/components/loading";
import { ReactionGlyph } from "@/components/reaction-bar";
import { loadServerEmojiMap } from "@/lib/server-emoji";

interface CreatorProfile {
  manualPaymentInstructions: string | null;
  welcomeMessageNewSubscriber: string | null;
  welcomeMessageRenewal: string | null;
  welcomeMessageDonor: string | null;
}

interface PendingItem {
  payment: {
    id: string;
    amountMinor: string;
    currency: string;
    payerMarkedPaidAt: string | null;
    createdAt: string;
  };
  kind: "PURCHASE" | "DONATION" | "SUBSCRIPTION" | "REWARD";
  label: string;
  payerUsername: string | null;
  /** A reward bought in this payment — the whole of it for kind REWARD. */
  rewardShortcode: string | null;
}

interface DiscountCode {
  id: string;
  code: string;
  type: "PERCENT_OFF" | "AMOUNT_OFF";
  value: number;
  maxRedemptions: number | null;
  redeemedCount: number;
  active: boolean;
  expiresAt: string | null;
}

function ManualPaymentInstructions() {
  const { t } = useLocale();
  const [instructions, setInstructions] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ creatorProfile: CreatorProfile }>("/creators/me")
      .then((res) => setInstructions(res.creatorProfile.manualPaymentInstructions ?? ""))
      .catch((err) => setError(err instanceof ApiError ? err.message : t("payments.settingsLoadError")))
      .finally(() => setLoaded(true));
  }, [t]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    setSaved(false);
    try {
      await apiFetch("/creators/me", {
        method: "PATCH",
        body: JSON.stringify({ manualPaymentInstructions: instructions }),
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("payments.settingsSaveError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack card" onSubmit={save}>
      <h2 style={{ margin: 0 }}>{t("payments.manualMethod")}</h2>
      <p className="lede" style={{ margin: 0 }}>
        {t("payments.instructionsLede")}
      </p>
      {error && <div className="error-banner">{error}</div>}
      <div className="form-field">
        <label htmlFor="instructions">{t("payments.instructions")}</label>
        <textarea
          id="instructions"
          rows={4}
          placeholder={t("payments.instructionsPlaceholder")}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
      </div>
      <button className="primary" type="submit" disabled={!loaded || busy}>
        {busy ? t("common.saving") : t("common.save")}
      </button>
      {saved && <span className="lede">{t("common.saved")}</span>}
    </form>
  );
}

function WelcomeMessages() {
  const { t } = useLocale();
  const [newSubscriber, setNewSubscriber] = useState("");
  const [renewal, setRenewal] = useState("");
  const [donor, setDonor] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ creatorProfile: CreatorProfile }>("/creators/me")
      .then((res) => {
        setNewSubscriber(res.creatorProfile.welcomeMessageNewSubscriber ?? "");
        setRenewal(res.creatorProfile.welcomeMessageRenewal ?? "");
        setDonor(res.creatorProfile.welcomeMessageDonor ?? "");
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : t("payments.welcomeLoadError")))
      .finally(() => setLoaded(true));
  }, [t]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    setSaved(false);
    try {
      await apiFetch("/creators/me", {
        method: "PATCH",
        body: JSON.stringify({
          welcomeMessageNewSubscriber: newSubscriber,
          welcomeMessageRenewal: renewal,
          welcomeMessageDonor: donor,
        }),
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("payments.welcomeSaveError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack card" onSubmit={save}>
      <h2 style={{ margin: 0 }}>{t("payments.welcomeTitle")}</h2>
      <p className="lede" style={{ margin: 0 }}>
        {t("payments.welcomeLede")}
      </p>
      {error && <div className="error-banner">{error}</div>}
      <div className="form-field">
        <label htmlFor="welcome-new">{t("payments.newSubscriber")}</label>
        <textarea id="welcome-new" rows={2} maxLength={1000} value={newSubscriber} onChange={(e) => setNewSubscriber(e.target.value)} />
      </div>
      <div className="form-field">
        <label htmlFor="welcome-renewal">{t("payments.renewal")}</label>
        <textarea id="welcome-renewal" rows={2} maxLength={1000} value={renewal} onChange={(e) => setRenewal(e.target.value)} />
      </div>
      <div className="form-field">
        <label htmlFor="welcome-donor">{t("payments.donor")}</label>
        <textarea id="welcome-donor" rows={2} maxLength={1000} value={donor} onChange={(e) => setDonor(e.target.value)} />
      </div>
      <button className="primary" type="submit" disabled={!loaded || busy}>
        {busy ? t("common.saving") : t("common.save")}
      </button>
      {saved && <span className="lede">{t("common.saved")}</span>}
    </form>
  );
}

function DiscountCodes() {
  const { t } = useLocale();
  const [codes, setCodes] = useState<DiscountCode[] | null>(null);
  const [code, setCode] = useState("");
  const [type, setType] = useState<"PERCENT_OFF" | "AMOUNT_OFF">("PERCENT_OFF");
  const [value, setValue] = useState("10");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ discountCodes: DiscountCode[] }>("/subscriptions/discount-codes/mine");
      setCodes(res.discountCodes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("payments.codesLoadError"));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiFetch("/subscriptions/discount-codes", {
        method: "POST",
        body: JSON.stringify({
          code: code.trim(),
          type,
          value: Number(value),
          maxRedemptions: maxRedemptions ? Number(maxRedemptions) : undefined,
        }),
      });
      setCode("");
      setValue("10");
      setMaxRedemptions("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("payments.codeCreateError"));
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(id: string) {
    setError(null);
    try {
      await apiFetch(`/subscriptions/discount-codes/${id}/deactivate`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("payments.codeDeactivateError"));
    }
  }

  return (
    <div className="stack card">
      <h2 style={{ margin: 0 }}>{t("payments.codesTitle")}</h2>
      {error && <div className="error-banner">{error}</div>}
      <form className="stack" style={{ gap: 8 }} onSubmit={create}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div className="form-field" style={{ flex: 1, minWidth: 120 }}>
            <label htmlFor="code">{t("common.code")}</label>
            <input id="code" required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          </div>
          <div className="form-field">
            <label htmlFor="type">{t("common.type")}</label>
            <select id="type" value={type} onChange={(e) => setType(e.target.value as "PERCENT_OFF" | "AMOUNT_OFF")}>
              <option value="PERCENT_OFF">% off</option>
              <option value="AMOUNT_OFF">{t("payments.amountOff")}</option>
            </select>
          </div>
          <div className="form-field" style={{ width: 100 }}>
            <label htmlFor="value">{t("common.value")}</label>
            <input id="value" type="number" min={1} required value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          <div className="form-field" style={{ width: 140 }}>
            <label htmlFor="max">{t("payments.maxUses")}</label>
            <input id="max" type="number" min={1} value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} />
          </div>
        </div>
        <button className="secondary" type="submit" disabled={busy}>
          {busy ? t("common.creating") : t("payments.createCode")}
        </button>
      </form>

      {codes === null && <Loading />}
      {codes?.length === 0 && <div className="empty-state">{t("payments.noCodes")}</div>}
      {codes && codes.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          {codes.map((c) => (
            <div key={c.id} className="card" style={{ padding: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <code>{c.code}</code>
              <span>{c.type === "PERCENT_OFF" ? `${c.value}% off` : `${c.value} off`}</span>
              <span className="lede" style={{ margin: 0 }}>
                {c.redeemedCount}{c.maxRedemptions ? ` / ${c.maxRedemptions}` : ""} used
              </span>
              <span className="status-pill">{t(c.active ? "discounts.active" : "discounts.inactive")}</span>
              {c.active && (
                <button className="secondary" onClick={() => deactivate(c.id)}>
                  {t("payments.deactivate")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PendingConfirmations() {
  const { t } = useLocale();
  const [items, setItems] = useState<PendingItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [stickers, setStickers] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!items?.some((i) => i.rewardShortcode)) return;
    let cancelled = false;
    loadServerEmojiMap().then((map) => !cancelled && setStickers(map));
    return () => {
      cancelled = true;
    };
  }, [items]);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ items: PendingItem[] }>("/payments/pending");
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("payments.pendingLoadError"));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  async function resolve(paymentId: string, action: "confirm" | "reject") {
    setBusyId(paymentId);
    setError(null);
    try {
      await apiFetch(`/payments/${paymentId}/${action}`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("payments.updateError"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="stack card">
      <h2 style={{ margin: 0 }}>{t("payments.pendingTitle")}</h2>
      <p className="lede" style={{ margin: 0 }}>
        {t("payments.pendingLede")}
      </p>
      {error && <div className="error-banner">{error}</div>}
      {items === null && <Loading />}
      {items?.length === 0 && <div className="empty-state">{t("payments.nothingPending")}</div>}
      {items && items.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          {items.map(({ payment, kind, label, payerUsername, rewardShortcode }) => (
            <div key={payment.id} className="card" style={{ padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <span className="badge">{t(`payments.kind.${kind}`)}</span>{" "}
                  {/* A tip has no title of its own; a reward is its sticker. */}
                  {(kind === "PURCHASE" || kind === "SUBSCRIPTION") && <strong>{label}</strong>}
                  {rewardShortcode && (
                    <span className="pending-reward">
                      {kind !== "REWARD" && <>+ {t("payments.withReward")} </>}
                      <ReactionGlyph value={`:${rewardShortcode}:`} stickers={stickers} />
                    </span>
                  )}
                  <div className="lede" style={{ margin: "4px 0 0" }}>
                    {payerUsername ? t("payments.from", { username: payerUsername }) : t("payments.fromAnonymous")} ·{" "}
                    {formatMoney(payment.amountMinor, payment.currency)}
                    {payment.payerMarkedPaidAt && ` · ${t("payments.markedByPayer")}`}
                  </div>
                </div>
                <div className="button-row">
                  <button className="primary" disabled={busyId === payment.id} onClick={() => resolve(payment.id, "confirm")}>
                    {t("payments.confirm")}
                  </button>
                  <button className="secondary" disabled={busyId === payment.id} onClick={() => resolve(payment.id, "reject")}>
                    {t("payments.reject")}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PaymentsDashboardPage() {
  const { t } = useLocale();
  const { user, loading } = useSession();

  if (loading) return <Loading />;
  if (!user || (user.role !== "CREATOR" && user.role !== "ADMIN")) {
    return <p className="lede">{t("payments.creatorsOnly")}</p>;
  }

  return (
    <div className="stack">
      <h1>{t("payments.title")}</h1>
      <PendingConfirmations />
      <ManualPaymentInstructions />
      <PayoutAddressManager />
      <WelcomeMessages />
      <DiscountCodes />
    </div>
  );
}
