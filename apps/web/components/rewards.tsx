"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiFetch, ApiError, API_URL, localizedErrorMessage } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { useLocale } from "./locale-provider";
import { useAuthPrompt } from "./auth-prompt";
import { PayoutAddressList, type PayoutWallet } from "./payout-addresses";
import { AwardIcon, CheckIcon, CloseIcon } from "./icons";
import { Loading } from "./loading";

export interface Reward {
  id: string;
  shortcode: string;
  imageUrl: string;
  priceMinor: string;
  currency: string;
  free: boolean;
}

interface Payment {
  id: string;
  status: string;
  amountMinor: string;
  currency: string;
  payerMarkedPaidAt: string | null;
}

/** The catalog changes only when the administrator edits it: one request a page. */
let catalog: Promise<Reward[]> | null = null;

export function loadRewardCatalog(): Promise<Reward[]> {
  catalog ??= apiFetch<{ rewards: Reward[] }>("/rewards")
    .then((res) => res.rewards)
    .catch(() => {
      catalog = null;
      return [];
    });
  return catalog;
}

export function useRewardCatalog(enabled = true): Reward[] | null {
  const [rewards, setRewards] = useState<Reward[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadRewardCatalog().then((list) => !cancelled && setRewards(list));
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return rewards;
}

/** A reward's picture; its alias if the file has gone. */
export function RewardImage({ reward, size = 56 }: { reward: Pick<Reward, "shortcode" | "imageUrl">; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <span className="reward-missing">:{reward.shortcode}:</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="reward-image"
      src={`${API_URL}${reward.imageUrl}`}
      alt={`:${reward.shortcode}:`}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

function priceLabel(reward: Reward, t: (key: "rewards.free") => string) {
  return reward.free ? t("rewards.free") : formatMoney(reward.priceMinor, reward.currency);
}

/** The tiles to choose one from: a radio group, since exactly one is chosen. */
function RewardTiles({
  rewards,
  selected,
  onSelect,
  label,
  small,
}: {
  rewards: Reward[];
  selected: string | null;
  onSelect: (id: string) => void;
  label: string;
  small?: boolean;
}) {
  const { t } = useLocale();
  return (
    <div className={`reward-tiles${small ? " is-small" : ""}`} role="radiogroup" aria-label={label}>
      {rewards.map((reward) => (
        <button
          key={reward.id}
          type="button"
          role="radio"
          aria-checked={selected === reward.id}
          className={`reward-tile${selected === reward.id ? " selected" : ""}`}
          onClick={() => onSelect(reward.id)}
        >
          <RewardImage reward={reward} size={small ? 40 : 56} />
          <span className="reward-price">{priceLabel(reward, t)}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * A reward added to a tip or a subscription: paid ones in the payment's
 * currency, and "none" — the default. The price is shown, never added
 * up here: the total comes back from the server with the payment.
 */
export function RewardChooser({
  currency,
  value,
  onChange,
}: {
  currency: string;
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(value !== null);
  const all = useRewardCatalog(open);
  const rewards = (all ?? []).filter((r) => !r.free && r.currency === currency);
  const chosen = rewards.find((r) => r.id === value) ?? null;

  if (!open) {
    return (
      <button type="button" className="link-button reward-add" onClick={() => setOpen(true)}>
        <AwardIcon size={16} />
        {t("rewards.addToPayment")}
      </button>
    );
  }
  return (
    <fieldset className="reward-chooser">
      <legend>{t("rewards.addToPayment")}</legend>
      {all === null ? (
        <Loading compact />
      ) : rewards.length === 0 ? (
        <p className="meta" style={{ margin: 0 }}>
          {t("rewards.noneInCurrency")}
        </p>
      ) : (
        <RewardTiles
          rewards={rewards}
          selected={value}
          onSelect={(id) => onChange(value === id ? null : id)}
          label={t("rewards.addToPayment")}
          small
        />
      )}
      {chosen && (
        <p className="meta" style={{ margin: 0 }}>
          {t("rewards.addsToPayment", { price: formatMoney(chosen.priceMinor, chosen.currency) })}
        </p>
      )}
    </fieldset>
  );
}

/** How to pay, once a payment exists: the author's instructions, addresses and "I've sent it". */
function PaymentSteps({
  payment,
  manualInstructions,
  wallets,
  onMarked,
}: {
  payment: Payment;
  manualInstructions: string | null;
  wallets: PayoutWallet[];
  onMarked: (payment: Payment) => void;
}) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function markPaid() {
    setBusy(true);
    setError(null);
    try {
      onMarked((await apiFetch<{ payment: Payment }>(`/payments/${payment.id}/mark-paid`, { method: "POST" })).payment);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("tip.markPaidError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      {error && <div className="error-banner">{error}</div>}
      <p style={{ margin: 0 }}>
        {t("rewards.toPay")} <strong>{formatMoney(payment.amountMinor, payment.currency)}</strong>
      </p>
      {manualInstructions && <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{manualInstructions}</p>}
      <PayoutAddressList wallets={wallets} />
      {payment.payerMarkedPaidAt ? (
        <p className="meta" style={{ margin: 0 }}>
          {t("rewards.markedPaid")}
        </p>
      ) : (
        <button className="secondary" onClick={markPaid} disabled={busy}>
          {busy ? "…" : t("tip.iveSentIt")}
        </button>
      )}
    </div>
  );
}

const MESSAGE_MAX = 100;

/**
 * "Give a reward": pick one, add a few words, choose whether the author
 * sees who sent it. A free one is given at once (and needs an account);
 * a paid one is a payment the author confirms, like a tip.
 */
function RewardSheet({ creatorUsername, onClose }: { creatorUsername: string; onClose: () => void }) {
  const { t } = useLocale();
  const { requireAccount } = useAuthPrompt();
  const rewards = useRewardCatalog();
  const [mounted, setMounted] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [given, setGiven] = useState<Reward | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [manualInstructions, setManualInstructions] = useState<string | null>(null);
  const [wallets, setWallets] = useState<PayoutWallet[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  // The cheapest one is chosen to begin with, so the button always says what it does.
  useEffect(() => {
    if (rewards && rewards.length > 0 && selected === null) setSelected(rewards[0]!.id);
  }, [rewards, selected]);

  useEffect(() => {
    if (mounted) panelRef.current?.querySelector<HTMLElement>("[role=radio][aria-checked=true], button")?.focus();
  }, [mounted, rewards]);

  const reward = rewards?.find((r) => r.id === selected) ?? null;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!reward) return;
    // A free reward is one per person a day — which needs knowing the person.
    if (reward.free && !requireAccount()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ payment: Payment | null; manualInstructions: string | null }>("/rewards/send", {
        method: "POST",
        body: JSON.stringify({ creatorUsername, rewardId: reward.id, message: message.trim() || undefined, anonymous }),
      });
      if (!res.payment) {
        setGiven(reward);
        return;
      }
      setPayment(res.payment);
      setManualInstructions(res.manualInstructions);
      apiFetch<{ wallets: PayoutWallet[] }>(`/wallets/${creatorUsername}`)
        .then((w) => setWallets(w.wallets))
        .catch(() => setWallets([]));
    } catch (err) {
      setError(localizedErrorMessage(err, t, "rewards.sendError"));
    } finally {
      setBusy(false);
    }
  }

  if (!mounted) return null;
  return createPortal(
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        ref={panelRef}
        className="modal-panel reward-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reward-sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="reward-sheet-title" style={{ margin: 0 }}>
            {t("rewards.sheetTitle")}
          </h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t("common.close")}>
            <CloseIcon size={18} />
          </button>
        </div>

        {given ? (
          <div className="reward-done" role="status">
            <RewardImage reward={given} size={96} />
            <p style={{ margin: 0 }}>
              <CheckIcon size={16} /> {t("rewards.given", { username: creatorUsername })}
            </p>
            <button className="secondary" onClick={onClose}>
              {t("common.close")}
            </button>
          </div>
        ) : payment ? (
          payment.status === "CONFIRMED" ? (
            <p role="status">{t("rewards.confirmed")}</p>
          ) : (
            <PaymentSteps payment={payment} manualInstructions={manualInstructions} wallets={wallets} onMarked={setPayment} />
          )
        ) : rewards === null ? (
          <Loading />
        ) : rewards.length === 0 ? (
          <p className="meta" style={{ margin: 0 }}>
            {t("rewards.noneOffered")}
          </p>
        ) : (
          <form className="stack" style={{ gap: 14 }} onSubmit={send}>
            <p className="meta" style={{ margin: 0 }}>
              {t("rewards.sheetLede", { username: creatorUsername })}
            </p>
            {error && <div className="error-banner">{error}</div>}
            <RewardTiles rewards={rewards} selected={selected} onSelect={setSelected} label={t("rewards.sheetTitle")} />

            <div className="form-field">
              <label htmlFor="reward-message">{t("rewards.message")}</label>
              <input
                id="reward-message"
                maxLength={MESSAGE_MAX}
                value={message}
                placeholder={t("rewards.messagePlaceholder")}
                onChange={(e) => setMessage(e.target.value)}
                aria-describedby="reward-message-count"
              />
              <span id="reward-message-count" className="meta reward-count">
                {message.length}/{MESSAGE_MAX}
              </span>
            </div>

            <label className="checkbox-row">
              <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
              {t("rewards.anonymous")}
            </label>

            <button className="primary" type="submit" disabled={busy || !reward}>
              {busy
                ? t("post.starting")
                : reward?.free
                  ? t("rewards.sendFree")
                  : t("rewards.sendFor", { price: reward ? formatMoney(reward.priceMinor, reward.currency) : "" })}
            </button>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** The profile's "Give a reward" button. Nothing to show when nothing is offered. */
export function RewardButton({ creatorUsername, variant = "button" }: { creatorUsername: string; variant?: "button" | "icon" }) {
  const { t } = useLocale();
  const rewards = useRewardCatalog();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  if (!rewards || rewards.length === 0) return null;
  return (
    <>
      {variant === "icon" ? (
        <button className="profile-action" type="button" aria-haspopup="dialog" aria-label={t("rewards.give")} title={t("rewards.give")} onClick={() => setOpen(true)}>
          <AwardIcon size={19} />
        </button>
      ) : (
        <button className="secondary" type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}>
          <AwardIcon size={16} />
          {t("rewards.give")}
        </button>
      )}
      {open && <RewardSheet creatorUsername={creatorUsername} onClose={close} />}
    </>
  );
}

export interface HeldReward {
  reward: Reward;
  count: number;
}

/** The rewards an author holds, each once with how many: a row of stickers. */
export function RewardCollection({ items }: { items: HeldReward[] }) {
  const { t } = useLocale();
  return (
    <ul className="reward-collection">
      {items.map(({ reward, count }) => (
        <li key={reward.id} title={`:${reward.shortcode}:`}>
          <RewardImage reward={reward} size={40} />
          {count > 1 && <span className="reward-times" aria-label={t("rewards.times", { count })}>×{count}</span>}
        </li>
      ))}
    </ul>
  );
}

/** On an author's page: what readers have given them. Nothing when there is nothing. */
export function CreatorRewards({ username }: { username: string }) {
  const { t } = useLocale();
  const [items, setItems] = useState<HeldReward[]>([]);
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ rewards: HeldReward[] }>(`/rewards/creator/${username}`)
      .then((res) => !cancelled && setItems(res.rewards))
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, [username]);
  if (items.length === 0) return null;
  return (
    <section className="profile-rewards" aria-labelledby="profile-rewards-heading">
      <h2 id="profile-rewards-heading" className="profile-rewards-heading">
        <AwardIcon size={16} />
        {t("rewards.title")}
      </h2>
      <RewardCollection items={items} />
    </section>
  );
}
