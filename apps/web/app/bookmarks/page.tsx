"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import { useSession } from "@/components/session-provider";
import { useLocale } from "@/components/locale-provider";
import { FeedCard, type FeedItem } from "@/components/feed-card";
import { AuthRequired } from "@/components/auth-prompt";
import { Loading } from "@/components/loading";

/**
 * The posts a reader saved, most recently saved first. A post un-saved
 * from here stays on the page (its icon just goes back to outline) until
 * the page is reloaded, so an accidental click can be undone in place.
 */
export default function BookmarksPage() {
  const { t } = useLocale();
  const { user, loading: sessionLoading } = useSession();
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    async (cursor?: string) => {
      try {
        const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
        const res = await apiFetch<{ items: FeedItem[]; nextCursor: string | null }>(`/bookmarks${query}`);
        setItems((prev) => (cursor && prev ? [...prev, ...res.items] : res.items));
        setNextCursor(res.nextCursor);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t("bookmarks.loadError"));
      }
    },
    [t],
  );

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  if (sessionLoading) return <Loading />;
  if (!user) return <AuthRequired />;

  return (
    <div className="stack">
      <div>
        <h1>{t("bookmarks.title")}</h1>
        <p className="lede">{t("bookmarks.lede")}</p>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {items === null && !error && <Loading />}

      {items?.length === 0 && (
        <div className="empty-state stack" style={{ gap: 12, alignItems: "center" }}>
          <span>{t("bookmarks.empty")}</span>
          <Link href="/feed" className="btn-primary">
            {t("bookmarks.browse")}
          </Link>
        </div>
      )}

      {items && items.length > 0 && (
        <div className="stack" style={{ gap: 12 }}>
          {items.map((p) => (
            <FeedCard key={p.id} item={p} />
          ))}
        </div>
      )}

      {nextCursor && (
        <button
          className="secondary"
          style={{ alignSelf: "center" }}
          disabled={loadingMore}
          onClick={async () => {
            setLoadingMore(true);
            await load(nextCursor);
            setLoadingMore(false);
          }}
        >
          {loadingMore ? (
            <>
              <span className="spinner is-small" aria-hidden="true" /> {t("common.loading")}
            </>
          ) : (
            t("feed.loadMore")
          )}
        </button>
      )}
    </div>
  );
}
