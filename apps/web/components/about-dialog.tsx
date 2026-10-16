"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { APP_NAME, PROJECT_AUTHORS, PROJECT_URL } from "@platform/shared";
import { apiFetch, ApiError } from "@/lib/api";
import { useLocale } from "./locale-provider";
import { useSession } from "./session-provider";
import { Loading } from "./loading";
import { CloseIcon } from "./icons";
import { formatDateTime } from "@/lib/dates";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

interface UpdateOverview {
  current: string;
  release: { version: string; url: string; publishedAt: string | null; zipUrl: string | null; signatureUrl: string | null } | null;
  checkedAt: string;
  error: string | null;
  newer: boolean;
  selfUpdate: { available: boolean; reason: string | null };
  status: { state: string; version?: string; message?: string; log?: string; at?: string } | null;
}

/** The version under the menu, as a button that opens "About". */
export function VersionButton({ version }: { version: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="app-version" onClick={() => setOpen(true)} aria-haspopup="dialog">
        {APP_NAME} v{version}
      </button>
      {open && <AboutDialog version={version} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * "About": what Cryptovich is, its version and its authors, a link to its
 * source — and, for an administrator, whether a newer release is out and a
 * button that has this server install it (deploy/updater), with its
 * progress until it is done.
 */
function AboutDialog({ version, onClose }: { version: string; onClose: () => void }) {
  const { t } = useLocale();
  const { user } = useSession();
  const isAdmin = user?.role === "ADMIN";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="modal-panel about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title">
        <div className="modal-head">
          <div className="stack" style={{ gap: 2 }}>
            <h2 id="about-title" style={{ margin: 0 }}>
              {APP_NAME}
            </h2>
            <span className="meta">{t("about.version", { version })}</span>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t("common.close")} title={t("common.close")}>
            <CloseIcon size={18} />
          </button>
        </div>
        <p style={{ margin: 0 }}>{t("about.what")}</p>
        <dl className="about-facts">
          <dt>{t("about.authors")}</dt>
          <dd>{PROJECT_AUTHORS.join(t("about.and"))}</dd>
          <dt>{t("about.source")}</dt>
          <dd>
            <a href={PROJECT_URL} target="_blank" rel="noreferrer noopener">
              {PROJECT_URL.replace(/^https:\/\//, "")}
            </a>
          </dd>
        </dl>
        {isAdmin && <UpdatePanel />}
      </section>
    </div>,
    document.body,
  );
}

function UpdatePanel() {
  const { t, locale } = useLocale();
  const [overview, setOverview] = useState<UpdateOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  const load = useCallback(
    async (refresh = false) => {
      setBusy(true);
      setError(null);
      try {
        setOverview(await apiFetch<UpdateOverview>(`/admin/updates${refresh ? "?refresh=1" : ""}`));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t("common.genericError"));
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // While the updater works, look at its progress every few seconds. The
  // site itself restarts on the way: a failed look is simply tried again.
  const working = overview?.status && ["downloading", "installing"].includes(overview.status.state);
  useEffect(() => {
    if (!working) return;
    const timer = window.setInterval(() => {
      apiFetch<{ status: UpdateOverview["status"] }>("/admin/updates/status")
        .then((res) => setOverview((prev) => (prev ? { ...prev, status: res.status } : prev)))
        .catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [working]);

  async function install() {
    if (!overview?.release) return;
    if (!window.confirm(t("about.installConfirm", { version: overview.release.version }))) return;
    setBusy(true);
    setError(null);
    setLocked(false);
    try {
      await apiFetch("/admin/updates/apply", { method: "POST", body: JSON.stringify({ version: overview.release.version }) });
      setOverview((prev) => (prev ? { ...prev, status: { state: "installing", version: prev.release?.version, message: t("about.queued") } } : prev));
    } catch (err) {
      if (err instanceof ApiError && err.code === "PARAMETERS_LOCKED") setLocked(true);
      else setError(err instanceof ApiError ? err.message : t("common.genericError"));
    } finally {
      setBusy(false);
    }
  }

  if (!overview) return busy ? <Loading /> : error ? <div className="error-banner">{error}</div> : null;
  const status = overview.status;
  return (
    <div className="about-update stack">
      <strong>{t("about.updates")}</strong>
      {error && <div className="error-banner">{error}</div>}
      {overview.error ? (
        <span className="meta">{t(`about.check.${overview.error}` as TranslationKey)}</span>
      ) : overview.newer && overview.release ? (
        <span>
          {t("about.newer", { version: overview.release.version })}{" "}
          <a href={overview.release.url} target="_blank" rel="noreferrer noopener">
            {t("about.whatsNew")}
          </a>
        </span>
      ) : (
        <span className="meta">{t("about.upToDate")}</span>
      )}
      <span className="meta">{t("about.checkedAt", { date: formatDateTime(overview.checkedAt, locale) })}</span>
      {status && (
        <div className={`about-status is-${status.state}`} role="status">
          <strong>{t(`about.state.${status.state}` as TranslationKey) || status.state}</strong>
          {status.version && ` · v${status.version}`}
          {status.message && <div className="meta">{status.message}</div>}
          {status.state === "failed" && status.log && <pre className="about-log">{status.log}</pre>}
        </div>
      )}
      {locked && (
        <div className="error-banner">
          {t("about.unlockFirst")} <Link href="/admin?tab=parameters">{t("about.unlockLink")}</Link>
        </div>
      )}
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="secondary" onClick={() => load(true)} disabled={busy}>
          {t("about.check")}
        </button>
        {overview.newer && overview.release && overview.selfUpdate.available && !working && (
          <button type="button" className="primary" onClick={install} disabled={busy}>
            {t("about.install", { version: overview.release.version })}
          </button>
        )}
      </div>
      {overview.newer && !overview.selfUpdate.available && (
        <span className="meta">{t(`about.manual.${overview.selfUpdate.reason ?? "NO_UPDATER"}` as TranslationKey)}</span>
      )}
    </div>
  );
}
