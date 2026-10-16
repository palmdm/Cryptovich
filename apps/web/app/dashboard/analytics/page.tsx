"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { useLocale } from "@/components/locale-provider";
import { Loading } from "@/components/loading";

type Period = "7d" | "30d" | "90d" | "1y" | "all";

interface Overview {
  period: Period;
  revenue: {
    grossByCurrency: Record<string, string>;
    bySource: {
      purchases: Record<string, string>;
      donations: Record<string, string>;
      subscriptions: Record<string, string>;
      rewards: Record<string, string>;
    };
  };
  counts: { purchases: number; donations: number; activeSubscribers: number; newSubscriptionPayments: number; rewards: number };
  topProducts: Array<{
    productId: string;
    title: string;
    slug: string;
    type: string;
    currency: string;
    revenueMinor: string;
    purchaseCount: number;
    viewCount: number;
    conversionRate: number | null;
  }>;
}

function formatMultiCurrency(minorByCurrency: Record<string, string>) {
  const entries = Object.entries(minorByCurrency);
  if (entries.length === 0) return "—";
  return entries.map(([currency, minor]) => formatMoney(minor, currency)).join(" + ");
}

const PERIODS: Period[] = ["7d", "30d", "90d", "1y", "all"];

export default function AnalyticsPage() {
  const { t, tn } = useLocale();
  const [period, setPeriod] = useState<Period>("30d");
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Overview>(`/analytics/overview?period=${period}`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : t("analytics.loadError")));
  }, [period, t]);

  return (
    <div className="stack">
      <div className="section-head">
        <h1>{t("analytics.title")}</h1>
        <div style={{ display: "flex", gap: 4 }}>
          {PERIODS.map((p) => (
            <button
              key={p}
              className={p === period ? "primary" : "secondary"}
              style={{ padding: "6px 12px" }}
              onClick={() => setPeriod(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      {error && <div className="error-banner">{error}</div>}
      {!data && !error && <Loading />}

      {data && (
        <>
          <div className="product-grid">
            <div className="card">
              <span className="lede">{t("analytics.grossRevenue")}</span>
              <div className="price-tag">{formatMultiCurrency(data.revenue.grossByCurrency)}</div>
            </div>
            <div className="card">
              <span className="lede">{t("analytics.fromPurchases")}</span>
              <div className="price-tag">{formatMultiCurrency(data.revenue.bySource.purchases)}</div>
              <span className="lede">{tn("analytics.purchasesCount", data.counts.purchases)}</span>
            </div>
            <div className="card">
              <span className="lede">{t("analytics.fromDonations")}</span>
              <div className="price-tag">{formatMultiCurrency(data.revenue.bySource.donations)}</div>
              <span className="lede">{tn("analytics.donationsCount", data.counts.donations)}</span>
            </div>
            <div className="card">
              <span className="lede">{t("analytics.fromSubscriptions")}</span>
              <div className="price-tag">{formatMultiCurrency(data.revenue.bySource.subscriptions)}</div>
              <span className="lede">{tn("analytics.activeSubscribersCount", data.counts.activeSubscribers)}</span>
            </div>
            <div className="card">
              <span className="lede">{t("analytics.fromRewards")}</span>
              <div className="price-tag">{formatMultiCurrency(data.revenue.bySource.rewards ?? {})}</div>
              <span className="lede">{tn("analytics.rewardsCount", data.counts.rewards ?? 0)}</span>
            </div>
          </div>

          <h2>{t("analytics.topProducts")}</h2>
          {data.topProducts.length === 0 && <div className="empty-state">{t("analytics.noSales")}</div>}
          {data.topProducts.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                    <th style={{ padding: 8 }}>{t("analytics.product")}</th>
                    <th style={{ padding: 8 }}>{t("common.type")}</th>
                    <th style={{ padding: 8 }}>{t("analytics.revenue")}</th>
                    <th style={{ padding: 8 }}>{t("analytics.purchases")}</th>
                    <th style={{ padding: 8 }}>{t("analytics.viewsAllTime")}</th>
                    <th style={{ padding: 8 }}>{t("analytics.conversion")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topProducts.map((p) => (
                    <tr key={p.productId} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: 8 }}>{p.title}</td>
                      <td style={{ padding: 8 }}>
                        <span className="badge">{p.type}</span>
                      </td>
                      <td style={{ padding: 8 }}>{formatMoney(p.revenueMinor, p.currency)}</td>
                      <td style={{ padding: 8 }}>{p.purchaseCount}</td>
                      <td style={{ padding: 8 }}>{p.viewCount}</td>
                      <td style={{ padding: 8 }}>{p.conversionRate !== null ? `${(p.conversionRate * 100).toFixed(1)}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
