"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, localizedErrorMessage, API_URL } from "@/lib/api";
import { DownloadIcon } from "@/components/icons";
import { formatMoney } from "@/lib/money";
import { useLocale } from "@/components/locale-provider";
import { Avatar } from "@/components/avatar";
import { formatDate } from "@/lib/dates";
import { Loading } from "@/components/loading";

interface Subscriber {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  avatarFrame: string | null;
  tier: { id: string; name: string; amountMinor: string; currency: string; period: string };
  status: string;
  startedAt: string;
  expiresAt: string;
  /** Set when they have cancelled but are paid up to the end of the period. */
  endingAt: string | null;
}


/**
 * Who is supporting this author, on what, and since when.
 *
 * Subscriptions on this server only. Someone following from the
 * fediverse holds no tier and pays nothing, so they are not counted here
 * — an author reading this number is reading what they are paid for.
 */
export default function SubscribersPage() {
  const { t, tn, locale } = useLocale();
  const [subscribers, setSubscribers] = useState<Subscriber[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSubscribers((await apiFetch<{ subscribers: Subscriber[] }>("/subscriptions/subscribers")).subscribers);
    } catch (err) {
      setError(localizedErrorMessage(err, t, "subscribers.loadError"));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const total = subscribers?.length ?? 0;
  const leaving = subscribers?.filter((s) => s.endingAt).length ?? 0;

  return (
    <div className="stack">
      <h1>{t("subscribers.title")}</h1>
      <p className="lede">{t("subscribers.lede")}</p>

      {error && <div className="error-banner">{error}</div>}
      {subscribers === null && !error && <Loading />}

      {subscribers && (
        <>
          <div className="profile-stats">
            <span>{tn("profile.subscribersCount", total)}</span>
            {leaving > 0 && <span className="meta">{t("subscribers.leaving", { count: leaving })}</span>}
            {subscribers.length > 0 && (
              <a className="btn-secondary export-link" href={`${API_URL}/subscriptions/subscribers/export`} download>
                <DownloadIcon size={16} />
                {t("subscribers.export")}
              </a>
            )}
          </div>

          {subscribers.length === 0 && <div className="empty-state">{t("subscribers.empty")}</div>}

          {subscribers.map((subscriber) => (
            <div key={subscriber.id} className="search-row">
              <Avatar url={subscriber.avatarUrl} name={subscriber.displayName} frame={subscriber.avatarFrame} size="sm" decorative />

              <span className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                <Link href={`/${subscriber.username}`}>
                  <strong>{subscriber.displayName}</strong>
                </Link>
                <span className="meta">
                  {subscriber.tier.name}
                  {" · "}
                  {subscriber.tier.amountMinor === "0"
                    ? t("common.free")
                    : formatMoney(subscriber.tier.amountMinor, subscriber.tier.currency)}
                  {" · "}
                  {t("subscribers.since", { date: formatDate(subscriber.startedAt, locale) })}
                </span>
              </span>

              {/* Cancelled but still inside the period they paid for: the
                  date is the useful part, not the word "cancelled". */}
              <span className="meta" style={{ textAlign: "right" }}>
                {subscriber.endingAt
                  ? t("subscribers.until", { date: formatDate(subscriber.endingAt, locale) })
                  : t("subscribers.renews", { date: formatDate(subscriber.expiresAt, locale) })}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
