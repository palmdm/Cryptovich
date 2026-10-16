"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import { useLocale } from "./locale-provider";
import { Avatar } from "./avatar";
import { CloseIcon } from "./icons";
import { ReactionGlyph, type ReactionSummary } from "./reaction-bar";
import { Loading } from "@/components/loading";

interface Person {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  avatarFrame: string | null;
  emojis: string[];
  postCount: number;
  subscriberCount: number | null;
}

interface PeoplePage {
  people: Person[];
  total: number;
  anonymous: number;
  nextOffset: number | null;
}

/**
 * Who reacted to a post: the accounts, newest first, each with their
 * reactions, and a count of readers who reacted without an account —
 * those have nobody to show. A row opens that person's page.
 */
export function ReactorsModal({
  productId,
  counts,
  stickers,
  onClose,
}: {
  productId: string;
  counts: ReactionSummary["counts"];
  stickers: Record<string, string>;
  onClose: () => void;
}) {
  const { t, tn } = useLocale();
  const [mounted, setMounted] = useState(false);
  const [emoji, setEmoji] = useState<string | null>(null);
  const [page, setPage] = useState<PeoplePage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const load = useCallback(
    async (offset: number) => {
      const query = new URLSearchParams();
      if (emoji) query.set("emoji", emoji);
      if (offset) query.set("offset", String(offset));
      const res = await apiFetch<PeoplePage>(`/products/${productId}/reactions/people?${query.toString()}`);
      setPage((prev) => (offset && prev ? { ...res, people: [...prev.people, ...res.people] } : res));
    },
    [productId, emoji],
  );

  useEffect(() => {
    setPage(null);
    setError(null);
    load(0).catch((err) => setError(err instanceof ApiError ? err.message : t("reactors.loadError")));
  }, [load, t]);

  const totalReactions = counts.reduce((sum, c) => sum + c.count, 0);
  if (!mounted) return null;

  return createPortal(
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal-panel reactors"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reactors-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="reactors-title" style={{ margin: 0 }}>
            {tn("reactors.heading", totalReactions)}
          </h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t("common.close")}>
            <CloseIcon size={18} />
          </button>
        </div>

        {counts.length > 1 && (
          <div className="reactors-filter" role="group" aria-label={t("reactors.filter")}>
            <button
              type="button"
              className={`reaction-pill${emoji === null ? " is-mine" : ""}`}
              aria-pressed={emoji === null}
              onClick={() => setEmoji(null)}
            >
              {t("reactors.all")}
            </button>
            {counts.map((c) => (
              <button
                key={c.emoji}
                type="button"
                className={`reaction-pill${emoji === c.emoji ? " is-mine" : ""}`}
                aria-pressed={emoji === c.emoji}
                onClick={() => setEmoji(c.emoji)}
              >
                <ReactionGlyph value={c.emoji} stickers={stickers} />
                <span className="reaction-count">{c.count}</span>
              </button>
            ))}
          </div>
        )}

        {error && <div className="error-banner">{error}</div>}
        {!page && !error && <Loading />}

        {page && (
          <ul className="reactors-list">
            {page.people.map((p) => (
              <li key={p.username}>
                <Link href={`/${p.username}`} className="reactors-row" onClick={onClose}>
                  <Avatar url={p.avatarUrl} name={p.displayName} frame={p.avatarFrame} size="sm" decorative />
                  <span className="reactors-who">
                    <strong>{p.displayName}</strong>
                    <span className="meta">
                      @{p.username} · {tn("profile.postsCount", p.postCount)}
                      {p.subscriberCount !== null && <> · {tn("profile.subscribersCount", p.subscriberCount)}</>}
                    </span>
                  </span>
                  <span className="reactors-emojis" aria-label={t("reactors.theirReactions")}>
                    {p.emojis.slice(0, 4).map((e) => (
                      <ReactionGlyph key={e} value={e} stickers={stickers} />
                    ))}
                  </span>
                </Link>
              </li>
            ))}
            {page.anonymous > 0 && (
              <li className="reactors-anonymous meta">
                {tn(page.people.length > 0 ? "reactors.anonymous" : "reactors.anonymousOnly", page.anonymous)}
              </li>
            )}
            {page.people.length === 0 && page.anonymous === 0 && <li className="meta">{t("reactors.empty")}</li>}
          </ul>
        )}

        {page?.nextOffset != null && (
          <button
            type="button"
            className="secondary"
            disabled={loadingMore}
            onClick={async () => {
              setLoadingMore(true);
              await load(page.nextOffset!).catch(() => undefined);
              setLoadingMore(false);
            }}
          >
            {loadingMore ? (
            <>
              <span className="spinner is-small" aria-hidden="true" /> {t("common.loading")}
            </>
          ) : (
            t("reactors.more")
          )}
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
