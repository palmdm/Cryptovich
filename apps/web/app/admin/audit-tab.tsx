"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/dates";
import { useLocale } from "@/components/locale-provider";
import { Loading } from "@/components/loading";
import { SearchIcon } from "@/components/icons";
import { SettingsScroller } from "@/components/settings-shell";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

interface AuditEntry {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown> | null;
  actorUsername: string | null;
  createdAt: string;
}

/** A detail worth a glance — the ids are already in the target column. */
function details(metadata: AuditEntry["metadata"]): string {
  if (!metadata) return "";
  return Object.entries(metadata)
    .filter(([key, value]) => !["id", "username", "productId"].includes(key) && value !== null && value !== undefined && typeof value !== "object")
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(", ");
}

/**
 * Admin → Журнал действий: what each administrator changed, newest first,
 * with a search over the action, its target and who did it (the server
 * searches, so the whole log is searched, not the page shown).
 */
export function AuditTab() {
  const { t, locale } = useLocale();
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const q = query.trim();
      apiFetch<{ entries: AuditEntry[] }>(`/admin/audit-log${q ? `?q=${encodeURIComponent(q)}` : ""}`)
        .then((res) => !cancelled && (setEntries(res.entries), setError(null)))
        .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : t("admin.loadError")));
    }, query ? 300 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, t]);

  const label = (action: string) => (t(`audit.action.${action}` as TranslationKey) as string | undefined) || action;

  return (
    <div className="stack" style={{ gap: 12 }}>
      <label className="audit-search">
        <SearchIcon size={16} />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("audit.search")}
          aria-label={t("audit.search")}
        />
      </label>
      {error && <div className="error-banner">{error}</div>}
      {!entries && !error && <Loading />}
      {entries?.length === 0 && <div className="empty-state">{query.trim() ? t("audit.nothingFound") : t("admin.empty")}</div>}
      {entries && entries.length > 0 && (
        <SettingsScroller>
          <table className="data-table audit-table">
            <thead>
              <tr>
                <th>{t("audit.when")}</th>
                <th>{t("audit.who")}</th>
                <th>{t("audit.what")}</th>
                <th>{t("audit.target")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const extra = details(e.metadata);
                return (
                  <tr key={e.id}>
                    <td className="meta" style={{ whiteSpace: "nowrap" }}>{formatDateTime(e.createdAt, locale)}</td>
                    <td>{e.actorUsername ? `@${e.actorUsername}` : "—"}</td>
                    <td>
                      {label(e.action)}
                      {extra && <div className="meta">{extra}</div>}
                    </td>
                    <td className="meta">
                      {e.targetType}
                      {e.targetId ? ` · ${e.targetId.length > 20 ? `${e.targetId.slice(0, 8)}…` : e.targetId}` : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </SettingsScroller>
      )}
    </div>
  );
}
