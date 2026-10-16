"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError, localizedErrorMessage } from "@/lib/api";
import { useSession } from "./session-provider";
import { useLocale } from "@/components/locale-provider";
import { GiftIcon } from "./icons";
import { PayoutAddressList, type PayoutWallet } from "./payout-addresses";
import { RewardChooser } from "./rewards";
import { formatMoney } from "@/lib/money";
import { DONATION_MIN_DECIMAL, DONATION_MAX_DECIMAL } from "@platform/shared";
import { StatusPill } from "@/components/status-pill";

interface Payment {
  id: string;
  status: string;
  amountMinor: string;
  currency: string;
  payerMarkedPaidAt: string | null;
}

// Presets cover the three tips people actually send: a small thanks, a
// standard one, and a deliberate one. Anything else goes in the field.
const PRESETS = ["5", "10", "25"];

export function DonateBox({ creatorUsername, variant = "button" }: { creatorUsername: string; variant?: "button" | "icon" }) {
  const { user } = useSession();
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("5");
  const [message, setMessage] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [rewardId, setRewardId] = useState<string | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [manualInstructions, setManualInstructions] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wallets, setWallets] = useState<PayoutWallet[]>([]);
  useEffect(() => {
    // Only once the panel is open: every profile page was fetching an
    // author's payout addresses whether or not anyone opened the tip box.
    if (!open) return;
    let cancelled = false;
    apiFetch<{ wallets: PayoutWallet[] }>(`/wallets/${creatorUsername}`)
      .then((res) => !cancelled && setWallets(res.wallets))
      .catch(() => !cancelled && setWallets([]));
    return () => {
      cancelled = true;
    };
  }, [creatorUsername, open]);


  const numericAmount = Number(amount);
  const amountValid =
    /^\d+(\.\d{1,2})?$/.test(amount) && numericAmount >= DONATION_MIN_DECIMAL && numericAmount <= DONATION_MAX_DECIMAL;

  async function startDonation(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch<{ payment: Payment; manualInstructions: string | null }>(
        "/donations/checkout",
        {
          method: "POST",
          body: JSON.stringify({
            creatorUsername,
            amountDecimal: amount,
            currency: "USD",
            message: message || undefined,
            isPublic,
            rewardId: rewardId ?? undefined,
          }),
        },
      );
      setPayment(res.payment);
      setManualInstructions(res.manualInstructions);
    } catch (err) {
      setError(localizedErrorMessage(err, t, "tip.startError"));
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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const panel = (
    <div className="tip-panel" id="tip-panel">
      {error && <div className="error-banner">{error}</div>}

      {!payment && (
        <form className="stack" style={{ gap: 12 }} onSubmit={startDonation}>
          <div className="row" style={{ gap: 8 }}>
            <GiftIcon size={18} />
            <h3>{t("tip.heading")} @{creatorUsername}</h3>
          </div>

          <div className="tip-amount">
            <label htmlFor="amount" className="visually-hidden">
              {t("tip.amountLabel")}
            </label>
            <span className="currency">$</span>
            <input
              id="amount"
              required
              inputMode="decimal"
              pattern="\d+(\.\d{1,2})?"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <span className="meta">
            {t("tip.range", { min: DONATION_MIN_DECIMAL, max: DONATION_MAX_DECIMAL.toLocaleString() })}
          </span>

          <div className="tip-presets">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={`chip${amount === preset ? " selected" : ""}`}
                onClick={() => setAmount(preset)}
              >
                ${preset}
              </button>
            ))}
          </div>

          {!user && <p className="meta">{t("tip.noAccountNeeded")}</p>}

          <RewardChooser currency="USD" value={rewardId} onChange={setRewardId} />

          <div className="form-field">
            <label htmlFor="message">{t("tip.message")}</label>
            <input id="message" maxLength={200} value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>

          <label className="checkbox-row" style={{ fontSize: "0.9rem" }}>
            <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
            {t("tip.showPublicly")}
          </label>

          <div className="row" style={{ gap: 8 }}>
            <button className="primary" type="submit" disabled={busy || !amountValid}>
              {busy ? t("post.starting") : `${t("tip.send")} $${amountValid ? amount : "—"}`}
            </button>
            <button className="secondary" type="button" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </button>
          </div>
        </form>
      )}

      {payment && (
        <div className="stack" style={{ gap: 12 }}>
          <StatusPill prefix="payments.status" status={payment.status} />

          {payment.status === "AWAITING_PAYMENT" && (
            <>
              <p style={{ margin: 0 }}>
                {t("rewards.toPay")} <strong>{formatMoney(payment.amountMinor, payment.currency)}</strong>
              </p>
              {manualInstructions && <p style={{ whiteSpace: "pre-wrap" }}>{manualInstructions}</p>}
              <PayoutAddressList wallets={wallets} />
              {payment.payerMarkedPaidAt ? (
                <p className="meta">{t("tip.markedPaid")}</p>
              ) : (
                <button className="secondary" onClick={markPaid} disabled={busy}>
                  {busy ? "…" : t("tip.iveSentIt")}
                </button>
              )}
            </>
          )}
          {payment.status === "CONFIRMED" && <p>{t("tip.thanks")}</p>}
          {payment.status === "FAILED" && <p>{t("tip.rejected")}</p>}
        </div>
      )}
    </div>
  );

  // The panel is a popover anchored under the button, not an inline
  // block: the profile header bottom-aligns its actions against an avatar
  // that overlaps the cover, so a panel growing in that row grew upward
  // over the header. Closing only hides it — a payment in progress is
  // still there when the button is pressed again.
  return (
    <div className="tip-anchor">
      {variant === "icon" ? (
        <button
          type="button"
          className="profile-action is-primary"
          aria-expanded={open}
          aria-controls={open ? "tip-panel" : undefined}
          aria-label={t("tip.open")}
          title={t("tip.open")}
          onClick={() => setOpen((v) => !v)}
        >
          <GiftIcon size={19} />
        </button>
      ) : (
        <button
          className="primary"
          aria-expanded={open}
          aria-controls={open ? "tip-panel" : undefined}
          onClick={() => setOpen((v) => !v)}
        >
          <GiftIcon size={16} />
          {t("tip.open")}
        </button>
      )}
      {open && panel}
    </div>
  );
}
