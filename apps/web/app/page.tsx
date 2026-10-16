"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import { useLocale } from "@/components/locale-provider";
import { Avatar } from "@/components/avatar";
import { useSession } from "@/components/session-provider";
import { Username } from "@/components/username";
import { Loading } from "@/components/loading";

interface DirectoryCreator {
  username: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  avatarFrame: string | null;
  publishedProductCount: number;
}

export default function HomePage() {
  const { t, tn } = useLocale();
  const { user } = useSession();
  const [creators, setCreators] = useState<DirectoryCreator[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The directory is public. It loads the same way whether or not anyone
  // is signed in — reading is never behind the session.
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ creators: DirectoryCreator[] }>("/creators")
      .then((res) => !cancelled && setCreators(res.creators))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : t("home.loadError")));
    return () => {
      cancelled = true;
    };
  }, [t]);

  return (
    <div className="stack" style={{ gap: 22 }}>
      {!user && (
        <div className="stack" style={{ gap: 6 }}>
          <h1>{t("home.title")}</h1>
          <p className="lede" style={{ maxWidth: "58ch" }}>
            {t("home.lede")}
          </p>
        </div>
      )}

      <h2>{t("home.authors")}</h2>

      {error && <div className="error-banner">{error}</div>}
      {!creators && !error && <Loading />}
      {creators?.length === 0 && <div className="empty-state">{t("home.noAuthors")}</div>}

      {creators && creators.length > 0 && (
        <div className="stack" style={{ gap: 10 }}>
          {creators.map((c) => (
            // The picture beside everything else; the post count is part of
            // the line under the name, where it reads as about this author.
            <Link key={c.username} href={`/${c.username}`} className="feed-card author-card">
              <Avatar url={c.avatarUrl} name={c.displayName} frame={c.avatarFrame} size="md" />
              <div className="author-card-text">
                <div className="author-card-name">{c.displayName}</div>
                <div className="meta">
                  <Username username={c.username} /> · {tn("profile.postsCount", c.publishedProductCount)}
                </div>
                {c.bio && <p className="author-card-bio">{c.bio}</p>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
