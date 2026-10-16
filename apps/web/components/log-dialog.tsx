"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ApiError } from "@/lib/api";
import { useLocale } from "./locale-provider";
import { Loading } from "./loading";
import { CloseIcon, SearchIcon } from "./icons";

export interface LogPage<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * A long list of what happened, over the page: an import's every sticker,
 * a post's every delivery to another server. Searchable, filterable by
 * outcome, a page at a time — the admin area's one way to show a log, so
 * "added 684, skipped 1289" can always be opened and read.
 */
export function LogDialog<T>({
  title,
  summary,
  filters,
  load,
  renderItem,
  itemKey,
  onClose,
}: {
  title: string;
  /** A line under the title: the totals, say. */
  summary?: ReactNode;
  /** Outcome filters; the first one is "everything" (value ""). */
  filters?: { value: string; label: string }[];
  load: (params: { q: string; filter: string; cursor: string | null }) => Promise<LogPage<T>>;
  renderItem: (item: T) => ReactNode;
  itemKey: (item: T) => string;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(filters?.[0]?.value ?? "");
  const [items, setItems] = useState<T[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Typing settles for a moment before it asks.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(q.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [q]);

  const fetchPage = useCallback(
    async (after: string | null) => {
      setBusy(true);
      setError(null);
      try {
        const page = await load({ q: query, filter, cursor: after });
        setItems((prev) => (after && prev ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t("common.genericError"));
      } finally {
        setBusy(false);
      }
    },
    [load, query, filter, t],
  );

  useEffect(() => {
    void fetchPage(null);
  }, [fetchPage]);

  useEffect(() => {
    searchRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="modal-panel log-dialog" role="dialog" aria-modal="true" aria-labelledby="log-dialog-title">
        <div className="modal-head">
          <div className="stack" style={{ gap: 4, minWidth: 0 }}>
            <h2 id="log-dialog-title" style={{ margin: 0 }}>
              {title}
            </h2>
            {summary && <div className="meta">{summary}</div>}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t("common.close")} title={t("common.close")}>
            <CloseIcon size={18} />
          </button>
        </div>
        <label className="search-form">
          <SearchIcon size={18} />
          <span className="visually-hidden">{t("log.search")}</span>
          <input ref={searchRef} type="search" value={q} placeholder={t("log.search")} onChange={(e) => setQ(e.target.value)} />
        </label>
        {filters && filters.length > 1 && (
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }} role="group" aria-label={t("log.filter")}>
            {filters.map((f) => (
              <button key={f.value || "all"} type="button" className={`chip${filter === f.value ? " selected" : ""}`} aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
                {f.label}
              </button>
            ))}
          </div>
        )}
        {error && <div className="error-banner">{error}</div>}
        <div className="log-dialog-list" aria-busy={busy}>
          {items === null ? (
            <Loading />
          ) : items.length === 0 ? (
            <div className="empty-state">{t("log.empty")}</div>
          ) : (
            <ul>
              {items.map((item) => (
                <li key={itemKey(item)}>{renderItem(item)}</li>
              ))}
            </ul>
          )}
          {cursor && (
            <button type="button" className="secondary" style={{ alignSelf: "center" }} disabled={busy} onClick={() => fetchPage(cursor)}>
              {busy ? t("common.loading") : t("feed.loadMore")}
            </button>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}
