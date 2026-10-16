"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, localizedErrorMessage } from "@/lib/api";
import { useLocale } from "@/components/locale-provider";
import { formatDate } from "@/lib/dates";
import { Loading } from "@/components/loading";
import { RewardCollection, RewardImage, type HeldReward, type Reward } from "@/components/rewards";

interface Gift {
  id: string;
  reward: Reward;
  /** Null when the sender chose to stay anonymous (or has no account). */
  senderUsername: string | null;
  message: string | null;
  grantedAt: string;
  free: boolean;
}

/**
 * What readers have given this author: each reward once with how many,
 * then the latest gifts with who sent them and what they wrote. These are
 * the stickers the author — and nobody else — can react with.
 */
export default function RewardsPage() {
  const { t, locale } = useLocale();
  const [data, setData] = useState<{ collection: HeldReward[]; recent: Gift[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiFetch<{ collection: HeldReward[]; recent: Gift[] }>("/rewards/received"));
    } catch (err) {
      setError(localizedErrorMessage(err, t, "rewards.loadError"));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="stack">
      <h1>{t("rewards.title")}</h1>
      <p className="lede">{t("rewards.dashboardLede")}</p>

      {error && <div className="error-banner">{error}</div>}
      {data === null && !error && <Loading />}

      {data && data.collection.length === 0 && <div className="empty-state">{t("rewards.empty")}</div>}

      {data && data.collection.length > 0 && (
        <>
          <section className="card stack" style={{ gap: 12 }}>
            <h2 style={{ margin: 0 }}>{t("rewards.collection")}</h2>
            <RewardCollection items={data.collection} />
          </section>

          <section className="stack" style={{ gap: 0 }}>
            <h2>{t("rewards.recent")}</h2>
            {data.recent.map((gift) => (
              <div key={gift.id} className="search-row reward-gift">
                <RewardImage reward={gift.reward} size={40} />
                <span className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                  <span>
                    {gift.senderUsername ? (
                      <Link href={`/${gift.senderUsername}`}>@{gift.senderUsername}</Link>
                    ) : (
                      <span className="meta">{t("rewards.anonymousSender")}</span>
                    )}
                    {gift.free && <span className="meta"> · {t("rewards.free")}</span>}
                  </span>
                  {gift.message && <span className="reward-message">{gift.message}</span>}
                </span>
                <span className="meta" style={{ textAlign: "right" }}>
                  {formatDate(gift.grantedAt, locale)}
                </span>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
