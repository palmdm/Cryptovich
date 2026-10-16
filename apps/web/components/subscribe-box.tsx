"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError, localizedErrorMessage } from "@/lib/api";
import { useAuthPrompt } from "./auth-prompt";
import { PayoutAddressList, type PayoutWallet } from "./payout-addresses";
import { RewardChooser } from "./rewards";
import { formatMoney } from "@/lib/money";
import { useLocale } from "@/components/locale-provider";
import { StatusPill } from "@/components/status-pill";

interface Payment {
  id: string;
  status: string;
  amountMinor: string;
  currency: string;
  payerMarkedPaidAt: string | null;
}

export function SubscribeBox({
  tierId,
  isFree,
  creatorUsername,
  currency,
}: {
  tierId: string;
  isFree: boolean;
  creatorUsername: string;
  currency: string;
}) {
  const { requireAccount } = useAuthPrompt();
  const { t } = useLocale();
  const [discountCode, setDiscountCode] = useState("");
  const [rewardId, setRewardId] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [manualInstructions, setManualInstructions] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wallets, setWallets] = useState<PayoutWallet[]>([]);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ wallets: PayoutWallet[] }>(`/wallets/${creatorUsername}`)
      .then((res) => !cancelled && setWallets(res.wallets))
      .catch(() => !cancelled && setWallets([]));
    return () => {
      cancelled = true;
    };
  }, [creatorUsername]);

  async function subscribe() {
    // Shown signed out too; a subscription belongs to an account.
    if (!requireAccount()) return;
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch<{
        payment: Payment | null;
        manualInstructions: string | null;
      }>("/subscriptions/checkout", {
        method: "POST",
        body: JSON.stringify({ tierId, discountCode: discountCode.trim() || undefined, rewardId: rewardId ?? undefined }),
      });
      if (!res.payment) {
        setSubscribed(true);
        return;
      }
      setPayment(res.payment);
      setManualInstructions(res.manualInstructions);
    } catch (err) {
      setError(localizedErrorMessage(err, t, "subscribe.error"));
    } finally {
      setBusy(false);
    }
  }

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

  if (subscribed || payment?.status === "CONFIRMED") {
    return <p style={{ margin: 0 }}>{isFree ? t("subscribe.followed") : t("subscribe.subscribed")}</p>;
  }

  if (!payment) {
    return (
      <div className="stack" style={{ gap: 8 }}>
        {error && <div className="error-banner">{error}</div>}
        {isFree ? (
          <button className="primary" onClick={subscribe} disabled={busy}>
            {busy ? t("subscribe.following") : t("subscribe.followFree")}
          </button>
        ) : !showOptions ? (
          // First the tier's button; the promo code and a reward come with
          // the checkout it opens, not behind a question of their own.
          <button className="primary" onClick={() => requireAccount() && setShowOptions(true)} disabled={busy}>
            {t("subscribe.subscribe")}
          </button>
        ) : (
          <form
            className="stack subscribe-checkout"
            style={{ gap: 10 }}
            onSubmit={(e) => {
              e.preventDefault();
              void subscribe();
            }}
          >
            <div className="form-field">
              <label htmlFor={`discount-${tierId}`}>{t("subscribe.discountCode")}</label>
              <input id={`discount-${tierId}`} value={discountCode} onChange={(e) => setDiscountCode(e.target.value)} autoComplete="off" />
            </div>
            <RewardChooser currency={currency} value={rewardId} onChange={setRewardId} />
            <div className="row" style={{ gap: 8 }}>
              <button className="primary" type="submit" disabled={busy}>
                {busy ? t("post.starting") : t("subscribe.toPayment")}
              </button>
              <button className="secondary" type="button" onClick={() => setShowOptions(false)} disabled={busy}>
                {t("common.cancel")}
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      {error && <div className="error-banner">{error}</div>}
      <StatusPill prefix="payments.status" status={payment.status} />

      {payment.status === "AWAITING_PAYMENT" && (
        <>
          <p style={{ margin: 0 }}>
            {t("rewards.toPay")} <strong>{formatMoney(payment.amountMinor, payment.currency)}</strong>
          </p>
          {manualInstructions && <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{manualInstructions}</p>}
          <PayoutAddressList wallets={wallets} />
          {payment.payerMarkedPaidAt ? (
            <p className="lede" style={{ margin: 0 }}>{t("tip.markedPaid")}</p>
          ) : (
            <button className="secondary" onClick={markPaid} disabled={busy}>
              {busy ? "…" : t("tip.iveSentIt")}
            </button>
          )}
        </>
      )}
      {payment.status === "FAILED" && <p style={{ margin: 0 }}>{t("tip.rejected")}</p>}
    </div>
  );
}
