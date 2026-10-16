"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import { useSession } from "@/components/session-provider";
import { useLocale } from "@/components/locale-provider";
import { FeedCard, type FeedItem } from "@/components/feed-card";
import { AuthRequired } from "@/components/auth-prompt";
import { Loading } from "@/components/loading";
import { PostComposer, type PostComposerHandle } from "@/components/post-composer";
import { COMPOSE_EVENT, PUBLISHED_EVENT } from "@/components/quick-post";

export default function FeedPage() {
  const { t } = useLocale();
  const { user, loading: sessionLoading } = useSession();
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const composer = useRef<PostComposerHandle>(null);
  const composerBox = useRef<HTMLElement>(null);
  const [called, setCalled] = useState(false);

  const load = useCallback(
    async (cursor?: string) => {
      try {
        const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
        const res = await apiFetch<{ items: FeedItem[]; nextCursor: string | null }>(`/feed${query}`);
        // Appends on a "load more", replaces on a first load.
        setItems((prev) => (cursor && prev ? [...prev, ...res.items] : res.items));
        setNextCursor(res.nextCursor);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t("feed.loadError"));
      }
    },
    [t],
  );

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  // The phone's "+" lands here (`?compose=1`, or an event when already
  // here): the editor is brought into view, focused and outlined for a
  // moment so the eye finds it.
  const callComposer = useCallback(() => {
    composerBox.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    composer.current?.focus();
    setCalled(true);
    window.setTimeout(() => setCalled(false), 2400);
  }, []);

  useEffect(() => {
    if (!user) return;
    if (new URLSearchParams(window.location.search).has("compose")) {
      window.history.replaceState(null, "", "/feed");
      // After the editor has rendered.
      window.setTimeout(callComposer, 50);
    }
    window.addEventListener(COMPOSE_EVENT, callComposer);
    return () => window.removeEventListener(COMPOSE_EVENT, callComposer);
  }, [user, callComposer]);

  // A post published here or from the floating editor shows up at once.
  useEffect(() => {
    if (!user) return;
    const reload = () => void load();
    window.addEventListener(PUBLISHED_EVENT, reload);
    return () => window.removeEventListener(PUBLISHED_EVENT, reload);
  }, [user, load]);

  // Each rendered card counts as one impression for its post, the same
  // rule the author's own page follows — in one call for the whole page,
  // not one per card.
  useEffect(() => {
    if (!items || items.length === 0) return;
    apiFetch("/products/impressions", {
      method: "POST",
      body: JSON.stringify({ productIds: items.map((item) => item.id) }),
    }).catch(() => {});
  }, [items]);

  if (sessionLoading) return <Loading />;
  if (!user) return <AuthRequired />;

  return (
    <div className="stack">
      <div>
        <h1>{t("feed.title")}</h1>
        <p className="lede">{t("feed.lede")}</p>
      </div>

      <section ref={composerBox} className={`feed-composer${called ? " is-called" : ""}`} aria-label={t("feed.composerTitle")}>
        <PostComposer ref={composer} rows={6} onPublished={() => window.dispatchEvent(new Event(PUBLISHED_EVENT))} />
      </section>

      {error && <div className="error-banner">{error}</div>}
      {items === null && !error && <Loading />}

      {items?.length === 0 && (
        <div className="empty-state stack" style={{ gap: 12, alignItems: "center" }}>
          <span>{t("feed.empty")}</span>
          <Link href="/" className="btn-primary">
            {t("feed.discover")}
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
