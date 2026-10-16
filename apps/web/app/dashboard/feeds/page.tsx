"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { useSession } from "@/components/session-provider";
import { useLocale } from "@/components/locale-provider";
import { formatDateTime } from "@/lib/dates";
import { Loading } from "@/components/loading";

type FeedPlatform = "MASTODON" | "SHARKEY" | "RSS";

const PLATFORM_LABELS: Record<FeedPlatform, string> = {
  MASTODON: "Mastodon",
  SHARKEY: "Sharkey",
  RSS: "RSS / Atom",
};

const PLATFORM_PLACEHOLDERS: Record<FeedPlatform, string> = {
  MASTODON: "https://mastodon.social/@you",
  SHARKEY: "https://your.instance/@you",
  RSS: "https://yourblog.com/feed.xml",
};

interface FeedSource {
  id: string;
  platform: FeedPlatform;
  actorUrl: string;
  active: boolean;
  lastFetchedAt: string | null;
  lastError: string | null;
  /** Posts this source brought in that are still on the page. */
  importedPosts: number;
}

function DualFeedSources() {
  const { t, locale } = useLocale();
  const [sources, setSources] = useState<FeedSource[] | null>(null);
  const [platform, setPlatform] = useState<FeedPlatform>("RSS");
  const [actorUrl, setActorUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ feedSources: FeedSource[] }>("/feed-sources/mine");
      setSources(res.feedSources);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("feeds.loadError"));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiFetch("/feed-sources", { method: "POST", body: JSON.stringify({ platform, actorUrl }) });
      setActorUrl("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("feeds.connectError"));
    } finally {
      setBusy(false);
    }
  }

  async function deleteImported(source: FeedSource) {
    if (!window.confirm(t("feeds.deleteImportedConfirm", { count: source.importedPosts }))) return;
    setError(null);
    try {
      const res = await apiFetch<{ removed: number }>(`/feed-sources/${source.id}/posts`, { method: "DELETE" });
      setNote(t("feeds.deletedImported", { count: res.removed }));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.genericError"));
    }
  }

  async function disconnect(id: string) {
    setError(null);
    try {
      await apiFetch(`/feed-sources/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("feeds.disconnectError"));
    }
  }

  return (
    <div className="stack card">
      <h2 style={{ margin: 0 }}>{t("feeds.secondTitle")}</h2>
      <p className="lede" style={{ margin: 0 }}>
        {t("feeds.secondLede")}
      </p>
      {error && <div className="error-banner">{error}</div>}
      <form className="stack" style={{ gap: 8 }} onSubmit={connect}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div className="form-field">
            <label htmlFor="platform">{t("feeds.platform")}</label>
            <select id="platform" value={platform} onChange={(e) => setPlatform(e.target.value as FeedPlatform)}>
              <option value="RSS">{t("feeds.rssOption")}</option>
              <option value="MASTODON">Mastodon</option>
              <option value="SHARKEY">Sharkey</option>
            </select>
          </div>
          <div className="form-field" style={{ flex: 1, minWidth: 220 }}>
            <label htmlFor="actorUrl">{platform === "RSS" ? t("feeds.feedUrl") : t("feeds.accountUrl")}</label>
            <input
              id="actorUrl"
              type="url"
              required
              placeholder={PLATFORM_PLACEHOLDERS[platform]}
              value={actorUrl}
              onChange={(e) => setActorUrl(e.target.value)}
            />
          </div>
        </div>
        <button className="secondary" type="submit" disabled={busy} style={{ alignSelf: "flex-start" }}>
          {busy ? t("feeds.connecting") : t("feeds.connect")}
        </button>
      </form>

      {note && (
        <p className="meta" role="status" style={{ margin: 0 }}>
          {note}
        </p>
      )}
      {sources === null && <Loading />}
      {sources?.length === 0 && <div className="empty-state">{t("feeds.empty")}</div>}
      {sources && sources.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          {sources.map((s) => (
            <div key={s.id} className="card" style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div>
                <span className="badge">{PLATFORM_LABELS[s.platform]}</span> {s.actorUrl}
                <div className="lede" style={{ margin: "4px 0 0", fontSize: "0.82rem" }}>
                  {s.active ? t("common.active") : t("common.disconnected")}
                  {s.lastFetchedAt && ` · ${t("feeds.lastChecked")} ${formatDateTime(s.lastFetchedAt, locale)}`}
                  {s.lastError && ` · ${t("feeds.error", { message: s.lastError })}`}
                </div>
              </div>
              {s.active && (
                <button className="secondary" onClick={() => disconnect(s.id)}>
                  {t("feeds.disconnect")}
                </button>
              )}
              {/* Once disconnected, what it brought in can go in one go. */}
              {!s.active && s.importedPosts > 0 && (
                <button className="danger" onClick={() => deleteImported(s)}>
                  {t("feeds.deleteImported", { count: s.importedPosts })}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FeedsDashboardPage() {
  const { user, loading } = useSession();
  const { t } = useLocale();

  if (loading) return <Loading />;
  if (!user || (user.role !== "CREATOR" && user.role !== "ADMIN")) {
    return <p className="lede">{t("feeds.onlyCreators")}</p>;
  }

  return (
    <div className="stack">
      <h1>{t("feeds.title")}</h1>
      <DualFeedSources />
    </div>
  );
}
