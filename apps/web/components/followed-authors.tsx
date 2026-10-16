"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { useLocale } from "./locale-provider";
import { Avatar } from "./avatar";
import { FollowButton } from "./follow-button";

interface Followed {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  avatarFrame: string | null;
}

/** "Authors you follow" on the subscriptions page: free follows, each with its own button to stop. */
export function FollowedAuthors() {
  const { t } = useLocale();
  const [follows, setFollows] = useState<Followed[] | null>(null);

  useEffect(() => {
    apiFetch<{ follows: Followed[] }>("/follows/mine")
      .then((res) => setFollows(res.follows))
      .catch(() => setFollows([]));
  }, []);

  if (follows === null) return null;
  return (
    <section className="stack" aria-labelledby="followed-title">
      <h2 id="followed-title" style={{ margin: 0 }}>
        {t("follow.myTitle")}
      </h2>
      {follows.length === 0 ? (
        <div className="empty-state">{t("follow.myEmpty")}</div>
      ) : (
        <ul className="followed-list">
          {follows.map((f) => (
            <li key={f.username} className="card followed-row">
              <Link href={`/${f.username}`} className="followed-who">
                <Avatar url={f.avatarUrl} name={f.displayName} frame={f.avatarFrame} size="sm" decorative />
                <span>
                  <strong>{f.displayName}</strong>
                  <span className="meta"> @{f.username}</span>
                </span>
              </Link>
              <FollowButton username={f.username} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
