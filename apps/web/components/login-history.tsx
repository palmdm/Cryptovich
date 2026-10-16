"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { CodeIcon, LogOutIcon, MonitorIcon, PhoneIcon, TabletIcon } from "./icons";
import { useLocale } from "./locale-provider";
import { useSession } from "./session-provider";
import { Loading } from "@/components/loading";

interface SignIn {
  id: string;
  signedInAt: string;
  userAgent: string | null;
  browser: string | null;
  os: string | null;
  kind: "desktop" | "phone" | "tablet" | "other";
  current: boolean;
  status: "ACTIVE" | "SIGNED_OUT" | "EXPIRED";
  /** How it was opened: "password", "qr" or "passkey". */
  method?: string;
  temporary?: boolean;
}

const KIND_ICON = { desktop: MonitorIcon, phone: PhoneIcon, tablet: TabletIcon, other: CodeIcon } as const;

/**
 * The account's recent sign-ins: when, on what, and the raw user agent the
 * device was read from — so a sign-in that is not yours can be told apart
 * from one that is, even when the guess at the device is wrong. A device
 * still signed in can be signed out from here, one at a time or all but
 * this one; this one is outlined.
 */
export function LoginHistory() {
  const { t, tn, locale } = useLocale();
  const { refresh } = useSession();
  const router = useRouter();
  const [rows, setRows] = useState<SignIn[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    return apiFetch<{ sessions: SignIn[] }>("/auth/sessions")
      .then((res) => setRows(res.sessions))
      .catch((err) => {
        // A scripted token is refused here on purpose; the page then simply
        // has no history to show rather than an error the reader can't act on.
        setError(err instanceof ApiError && err.status === 403 ? null : t("security.historyError"));
        setRows([]);
      });
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  async function signOut(row: SignIn) {
    setBusy(row.id);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/auth/sessions/${row.id}`, { method: "DELETE" });
      if (row.current) {
        await refresh();
        router.push("/login");
        return;
      }
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("security.signOutError"));
    } finally {
      setBusy(null);
    }
  }

  async function signOutOthers() {
    setBusy("others");
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<{ ended: number }>("/auth/sessions/end-others", { method: "POST" });
      setNotice(tn("security.endedOthers", res.ended));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("security.signOutError"));
    } finally {
      setBusy(null);
    }
  }

  const othersActive = rows?.some((row) => row.status === "ACTIVE" && !row.current) ?? false;

  return (
    <div className="card stack">
      <div className="section-head">
        <div>
          <h2 style={{ margin: 0 }}>{t("security.history")}</h2>
          <p className="lede" style={{ margin: "4px 0 0" }}>
            {t("security.historyLede")}
          </p>
          {/* Always present, so the result is announced when it appears. */}
          <p className="meta" role="status" style={{ margin: notice ? "6px 0 0" : 0 }}>
            {notice}
          </p>
        </div>
        {othersActive && (
          <button type="button" className="secondary" disabled={busy !== null} onClick={signOutOthers}>
            <LogOutIcon size={16} />
            {t("security.signOutOthers")}
          </button>
        )}
      </div>
      {error && <div className="error-banner">{error}</div>}
      {rows === null && !error && <Loading />}
      {rows?.length === 0 && !error && <p className="lede">{t("security.historyEmpty")}</p>}
      {rows && rows.length > 0 && (
        <ul className="login-history">
          {rows.map((row) => {
            const Icon = KIND_ICON[row.kind];
            const name = [row.browser, row.os].filter(Boolean).join(" · ") || t("security.unknownDevice");
            const label = row.current ? t("security.signOutHere") : t("security.signOutDevice", { device: name });
            return (
              <li key={row.id} className={`login-history-item${row.current ? " is-current" : ""}`}>
                <span className="login-history-icon" title={t(`security.device.${row.kind}`)}>
                  <Icon size={20} />
                </span>
                <div className="login-history-body">
                  <div className="login-history-head">
                    <strong>{name}</strong>
                    {row.current && <span className="badge login-history-current">{t("security.thisDevice")}</span>}
                    <span className={`badge login-history-status is-${row.status.toLowerCase()}`}>
                      {t(`security.session.${row.status}`)}
                    </span>
                  </div>
                  <div className="meta">
                    {new Date(row.signedInAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "medium" })}
                    {" · "}
                    {t(`security.device.${row.kind}`)}
                    {row.method === "qr" && <> · {t("security.method.qr")}</>}
                    {row.method === "passkey" && <> · {t("security.method.passkey")}</>}
                    {row.temporary && <> · {t("security.method.temporary")}</>}
                  </div>
                  <code className="login-history-ua">{row.userAgent ?? t("security.noUserAgent")}</code>
                </div>
                {row.status === "ACTIVE" && (
                  <button
                    type="button"
                    className="icon-button login-history-signout"
                    aria-label={label}
                    title={label}
                    disabled={busy !== null}
                    onClick={() => signOut(row)}
                  >
                    <LogOutIcon size={18} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
