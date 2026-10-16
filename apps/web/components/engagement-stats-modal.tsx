"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { apiFetch, ApiError } from "@/lib/api";
import { useLocale } from "./locale-provider";
import { CloseIcon } from "./icons";
import { Loading } from "@/components/loading";

interface EngagementStats {
  impressions: number;
  opens: number;
  reactions: number;
  comments: number;
  bookmarks: number;
  total: number;
}

/** 9547 → "9.5K", 10000 → "10K" — the headline figure only; the breakdown below it stays exact. */
function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10}K`;
  }
  const m = n / 1_000_000;
  return `${m >= 10 ? Math.round(m) : Math.round(m * 10) / 10}M`;
}

/**
 * The breakdown behind a post's engagement figure, author-only. Opened
 * by clicking the view count on the dashboard's post row.
 */
export function EngagementStatsModal({ productId, onClose }: { productId: string; onClose: () => void }) {
  const { t } = useLocale();
  const [stats, setStats] = useState<EngagementStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The portal target only exists in the browser, so the first render on
  // the server (and the hydration pass) has to match by rendering nothing.
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ stats: EngagementStats }>(`/products/${productId}/stats`)
      .then((res) => !cancelled && setStats(res.stats))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : t("stats.loadError")));
    return () => {
      cancelled = true;
    };
  }, [productId, t]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    // The page behind a modal must not scroll under it.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const rows: { value: number; label: string }[] = stats
    ? [
        { value: stats.impressions, label: t("stats.impressions") },
        { value: stats.opens, label: t("stats.opens") },
        { value: stats.reactions, label: t("stats.reactions") },
        { value: stats.comments, label: t("stats.comments") },
        { value: stats.bookmarks, label: t("stats.bookmarks") },
      ]
    : [];

  if (!mounted) return null;

  // Rendered into <body> rather than in place: a modal nested inside the
  // post list inherits any ancestor that creates a containing block for
  // fixed positioning (a transform, filter, backdrop-filter or contain),
  // which silently traps it inside the card it was opened from.
  return createPortal(
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("stats.title")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 style={{ margin: 0 }}>
            {stats ? t("stats.heading", { count: compact(stats.total) }) : t("stats.title")}
          </h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t("common.close")}>
            <CloseIcon size={18} />
          </button>
        </div>

        {error && <div className="error-banner">{error}</div>}
        {!stats && !error && <Loading />}

        {stats && (
          <div className="stats-grid">
            {rows.map((row) => (
              <div key={row.label} className="stats-cell">
                <strong className="stats-value">{row.value.toLocaleString()}</strong>
                <span className="meta">{row.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
