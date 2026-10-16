"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError, API_URL } from "@/lib/api";
import { FollowedAuthors } from "@/components/followed-authors";
import { DownloadIcon } from "@/components/icons";
import { useSession } from "@/components/session-provider";
import { useLocale } from "@/components/locale-provider";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { AuthRequired } from "@/components/auth-prompt";
import { Loading } from "@/components/loading";

interface Subscription {
  id: string;
  status: string;
  expiresAt: string;
  cancelledAt: string | null;
  tier: {
    name: string;
    currency: string;
    amountMinor: string;
    period: "MONTH" | "YEAR";
    creator: { user: { username: string } };
  };
}

export default function SubscriptionsPage() {
  const { user, loading: sessionLoading } = useSession();
  const { t, locale } = useLocale();
  const [subs, setSubs] = useState<Subscription[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ subscriptions: Subscription[] }>("/subscriptions/mine");
      setSubs(res.subscriptions);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("subscriptions.loadError"));
    }
  }, [t]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  async function cancel(id: string) {
    setError(null);
    try {
      await apiFetch(`/subscriptions/${id}/cancel`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("subscriptions.cancelError"));
    }
  }

  if (sessionLoading) return <Loading />;
  if (!user) return <AuthRequired />;

  return (
    <div className="stack">
      <h1>{t("subscriptions.title")}</h1>
      {error && <div className="error-banner">{error}</div>}
      {subs && subs.length > 0 && (
        <div className="export-bar">
          <a className="btn-secondary" href={`${API_URL}/subscriptions/mine/export`} download>
            <DownloadIcon size={16} />
            {t("subscriptions.exportCsv")}
          </a>
          <a className="btn-secondary" href={`${API_URL}/subscriptions/mine/export?format=mastodon`} download>
            <DownloadIcon size={16} />
            {t("subscriptions.exportMastodon")}
          </a>
          <span className="meta">{t("subscriptions.exportHint")}</span>
        </div>
      )}
      {subs?.length === 0 && <div className="empty-state">{t("subscriptions.empty")}</div>}
      {subs && subs.length > 0 && (
        <div className="stack">
          {subs.map((s) => (
            <div key={s.id} className="card">
              <strong>{s.tier.name}</strong>
              <span style={{ color: "var(--text-muted)" }}> · @{s.tier.creator.user.username}</span>
              <div style={{ marginTop: 8, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <span className="price-tag">
                  {formatMoney(s.tier.amountMinor, s.tier.currency)} /{" "}
                  {t(s.tier.period === "MONTH" ? "common.perMonth" : "common.perYear")}
                </span>
                <span className="status-pill">
                  {t(s.cancelledAt ? "subscriptions.cancelsOn" : "subscriptions.renewsOn", { date: formatDate(s.expiresAt, locale) })}
                </span>
                {!s.cancelledAt && (
                  <button className="secondary" onClick={() => cancel(s.id)}>
                    {t("subscriptions.cancel")}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <FollowedAuthors />
    </div>
  );
}
