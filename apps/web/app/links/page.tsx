"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { postPathFor } from "@platform/shared";
import { apiFetch, ApiError } from "@/lib/api";
import { useSession } from "@/components/session-provider";
import { useLocale } from "@/components/locale-provider";
import { AuthRequired } from "@/components/auth-prompt";
import { Loading } from "@/components/loading";
import { CopyButton } from "@/components/copy-button";
import { BarChartIcon, CloseIcon, TrashIcon } from "@/components/icons";
import { formatDate, formatDateTime } from "@/lib/dates";

interface ShortLink {
  id: string;
  code: string;
  shortUrl: string;
  targetUrl: string;
  title: string | null;
  clicks: number;
  createdAt: string;
}

interface Usage {
  byDay: { day: string; count: number }[];
  readers: { username: string; clicks: number; lastAt: string | null }[];
  anonymous: number;
  sites: { host: string | null; count: number }[];
}

interface PersonalGroup {
  productId: string;
  postTitle: string;
  targetUrl: string;
  links: number;
  clicks: number;
  readers: Usage["readers"];
  anonymous: number;
}

/**
 * "Links": short addresses on this site's own domain (/s/<code>) — any
 * address, its parameters kept, and who followed it: how many, from where,
 * and which members (only those signed in here). Below, the personal links
 * the author's posts made from @[text](url), one per reader.
 */
export default function LinksPage() {
  const { t } = useLocale();
  const { user, loading } = useSession();
  const [links, setLinks] = useState<ShortLink[] | null>(null);
  const [personal, setPersonal] = useState<PersonalGroup[]>([]);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statsFor, setStatsFor] = useState<ShortLink | null>(null);

  const load = useCallback(async () => {
    try {
      const [mine, groups] = await Promise.all([
        apiFetch<{ links: ShortLink[] }>("/short-links/mine"),
        apiFetch<{ groups: PersonalGroup[] }>("/short-links/personal"),
      ]);
      setLinks(mine.links);
      setPersonal(groups.groups);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.genericError"));
    }
  }, [t]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/short-links", { method: "POST", body: JSON.stringify({ url: url.trim(), title: title.trim() || undefined }) });
      setUrl("");
      setTitle("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.genericError"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(link: ShortLink) {
    if (!window.confirm(t("links.deleteConfirm", { url: link.shortUrl }))) return;
    try {
      await apiFetch(`/short-links/${link.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.genericError"));
    }
  }

  if (loading) return <Loading />;
  if (!user) return <AuthRequired />;

  return (
    <div className="stack">
      <div>
        <h1>{t("links.title")}</h1>
        <p className="lede">{t("links.lede")}</p>
      </div>
      {error && <div className="error-banner">{error}</div>}

      <form className="card stack" onSubmit={create}>
        <div className="form-field">
          <label htmlFor="link-url">{t("links.url")}</label>
          <input id="link-url" type="url" required maxLength={2000} placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="link-title">{t("links.name")}</label>
          <input id="link-title" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <span className="meta">{t("links.paramsHint")}</span>
        <button className="primary" type="submit" disabled={busy || !url.trim()} style={{ alignSelf: "flex-start" }}>
          {busy ? t("common.saving") : t("links.create")}
        </button>
      </form>

      {links === null ? (
        <Loading />
      ) : links.length === 0 ? (
        <div className="empty-state">{t("links.empty")}</div>
      ) : (
        <ul className="short-links">
          {links.map((link) => (
            <li key={link.id} className="card short-link">
              <div className="short-link-main">
                <strong>{link.title || link.targetUrl}</strong>
                <a className="short-link-url" href={link.shortUrl} target="_blank" rel="noreferrer">
                  {link.shortUrl.replace(/^https?:\/\//, "")}
                </a>
                <span className="meta short-link-target">→ {link.targetUrl}</span>
              </div>
              <span className="short-link-clicks" title={t("links.clicks")}>
                {t("links.clicksCount", { count: link.clicks })}
              </span>
              <div className="row" style={{ gap: 6 }}>
                <CopyButton value={link.shortUrl} label={t("links.copy")} />
                <button type="button" className="action-item is-icon" onClick={() => setStatsFor(link)} aria-label={t("links.stats")} title={t("links.stats")}>
                  <BarChartIcon size={16} />
                </button>
                <button type="button" className="action-item is-icon is-danger" onClick={() => remove(link)} aria-label={t("common.delete")} title={t("common.delete")}>
                  <TrashIcon size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <section className="stack" aria-labelledby="personal-title">
        <h2 id="personal-title" style={{ margin: 0 }}>
          {t("links.personalTitle")}
        </h2>
        <p className="meta" style={{ margin: 0 }}>
          {t("links.personalHint")}
        </p>
        {personal.length === 0 ? (
          <div className="empty-state">{t("links.personalEmpty")}</div>
        ) : (
          <ul className="short-links">
            {personal.map((g) => (
              <li key={`${g.productId}-${g.targetUrl}`} className="card stack" style={{ gap: 8 }}>
                <div className="short-link-main">
                  <Link href={postPathFor(user.username, g.productId)}>
                    <strong>{g.postTitle}</strong>
                  </Link>
                  <span className="meta short-link-target">→ {g.targetUrl}</span>
                </div>
                <span className="meta">
                  {t("links.personalTotals", { links: g.links, clicks: g.clicks, anonymous: g.anonymous })}
                </span>
                {g.readers.length > 0 && <ReaderList readers={g.readers} />}
              </li>
            ))}
          </ul>
        )}
      </section>

      {statsFor && <StatsDialog link={statsFor} onClose={() => setStatsFor(null)} />}
    </div>
  );
}

function ReaderList({ readers }: { readers: Usage["readers"] }) {
  const { t, locale } = useLocale();
  return (
    <ul className="link-readers">
      {readers.map((r) => (
        <li key={r.username}>
          <Link href={`/${r.username}`}>@{r.username}</Link>
          <span className="meta">
            {t("links.clicksCount", { count: r.clicks })}
            {r.lastAt && ` · ${formatDateTime(r.lastAt, locale)}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function StatsDialog({ link, onClose }: { link: ShortLink; onClose: () => void }) {
  const { t, locale } = useLocale();
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => {
    apiFetch<Usage>(`/short-links/${link.id}/stats`)
      .then(setUsage)
      .catch(() => setUsage({ byDay: [], readers: [], anonymous: 0, sites: [] }));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [link.id, onClose]);
  const max = Math.max(1, ...(usage?.byDay.map((d) => d.count) ?? [1]));
  return createPortal(
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="modal-panel log-dialog" role="dialog" aria-modal="true" aria-labelledby="link-stats-title">
        <div className="modal-head">
          <div className="stack" style={{ gap: 4, minWidth: 0 }}>
            <h2 id="link-stats-title" style={{ margin: 0 }}>
              {link.title || link.shortUrl}
            </h2>
            <span className="meta">{t("links.clicksCount", { count: link.clicks })}</span>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t("common.close")} title={t("common.close")}>
            <CloseIcon size={18} />
          </button>
        </div>
        {usage === null ? (
          <Loading />
        ) : (
          <div className="log-dialog-list">
            <strong>{t("links.byDay")}</strong>
            {usage.byDay.length === 0 ? (
              <span className="meta">{t("links.noClicks")}</span>
            ) : (
              <ul className="link-days">
                {usage.byDay.map((d) => (
                  <li key={d.day}>
                    <span className="meta">{formatDate(d.day, locale)}</span>
                    <span className="link-day-bar" style={{ width: `${(d.count / max) * 100}%` }} />
                    <span>{d.count}</span>
                  </li>
                ))}
              </ul>
            )}
            <strong>{t("links.readers")}</strong>
            {usage.readers.length === 0 ? <span className="meta">{t("links.noReaders")}</span> : <ReaderList readers={usage.readers} />}
            <span className="meta">{t("links.anonymous", { count: usage.anonymous })}</span>
            <strong>{t("links.sites")}</strong>
            <ul className="link-readers">
              {usage.sites.map((s) => (
                <li key={s.host ?? "-"}>
                  <span>{s.host ?? t("links.directVisit")}</span>
                  <span className="meta">{s.count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
