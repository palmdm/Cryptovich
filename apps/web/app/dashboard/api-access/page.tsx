"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError, API_URL } from "@/lib/api";
import { FileTextIcon } from "@/components/icons";
import { useSession } from "@/components/session-provider";
import { useLocale } from "@/components/locale-provider";
import { PayoutAddressList, type PayoutWallet } from "@/components/payout-addresses";
import { formatMoney } from "@/lib/money";
import { Loading } from "@/components/loading";
import { StatusPill } from "@/components/status-pill";

interface Terms {
  minMinor: string;
  maxMinor: string;
  currency: string;
  admin: { username: string; email: string | null } | null;
  wallets: PayoutWallet[];
}

interface MyRequest {
  id: string;
  status: "REQUESTED" | "APPROVED" | "REJECTED" | "REVOKED";
  amountMinor: string;
  currency: string;
  note: string | null;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  hasKey: boolean;
}

/**
 * Where a user asks for programmatic access. Running the API costs the
 * operator money, so the key is issued after a contribution the
 * administrator confirms by hand — the same trust-based confirmation
 * every payment here uses, because the platform never holds funds.
 */
export default function ApiAccessPage() {
  const { user, loading } = useSession();
  const { t } = useLocale();
  const [terms, setTerms] = useState<Terms | null>(null);
  const [mine, setMine] = useState<MyRequest | null>(null);
  const [amount, setAmount] = useState("10.00");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [termsRes, mineRes] = await Promise.all([
        apiFetch<Terms>("/api-access/terms"),
        apiFetch<{ request: MyRequest | null }>("/api-access/mine"),
      ]);
      setTerms(termsRes);
      setMine(mineRes.request);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.genericError"));
    }
  }, [t]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api-access/requests", {
        method: "POST",
        body: JSON.stringify({ amountDecimal: amount, note: note.trim() || undefined }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.genericError"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;
  if (!user) return <p className="lede">{t("dashboard.signIn")}</p>;

  return (
    <div className="stack">
      <h1>{t("apiAccess.title")}</h1>
      <p className="lede" style={{ maxWidth: "62ch" }}>
        {t("apiAccess.lede")}
      </p>
      <div>
        <a className="btn-secondary" href={`${API_URL}/docs`} target="_blank" rel="noreferrer">
          <FileTextIcon size={16} />
          {t("tokens.docs")}
        </a>
      </div>
      {error && <div className="error-banner">{error}</div>}

      {mine && (
        <div className="card stack" style={{ gap: 8 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <StatusPill prefix="apiAccess.status" status={mine.status} />
            <span className="price-tag">{formatMoney(mine.amountMinor, mine.currency)}</span>
          </div>
          {mine.reviewNote && <p className="meta">{mine.reviewNote}</p>}
          {mine.status === "APPROVED" && <p>{t("apiAccess.approved")}</p>}
          {mine.status === "REQUESTED" && <p className="meta">{t("apiAccess.pending")}</p>}
        </div>
      )}

      {terms && !mine && (
        <>
          <div className="card stack" style={{ gap: 10 }}>
            <h2 style={{ margin: 0 }}>{t("apiAccess.howToPay")}</h2>
            {terms.admin ? (
              <p className="meta">
                {t("apiAccess.sendTo")} <strong>@{terms.admin.username}</strong>
                {terms.admin.email && (
                  <>
                    {" · "}
                    <a className="text-link" href={`mailto:${terms.admin.email}`}>
                      {terms.admin.email}
                    </a>
                  </>
                )}
              </p>
            ) : (
              <p className="meta">{t("apiAccess.noAdmin")}</p>
            )}
            <PayoutAddressList wallets={terms.wallets} />
          </div>

          <form className="card stack" onSubmit={submit}>
            <h2 style={{ margin: 0 }}>{t("apiAccess.requestTitle")}</h2>
            <div className="form-field">
              <label htmlFor="amount">{t("form.amount")} ($)</label>
              <input
                id="amount"
                required
                inputMode="decimal"
                pattern="\d+(\.\d{1,2})?"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <span className="meta">
                {t("tip.range", {
                  min: Number(terms.minMinor) / 100,
                  max: Number(terms.maxMinor) / 100,
                })}
              </span>
            </div>
            <div className="form-field">
              <label htmlFor="note">{t("apiAccess.noteLabel")}</label>
              <input id="note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
              <span className="meta">{t("apiAccess.noteHint")}</span>
            </div>
            <button className="primary" type="submit" disabled={busy} style={{ width: "fit-content" }}>
              {busy ? t("common.saving") : t("apiAccess.submit")}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
