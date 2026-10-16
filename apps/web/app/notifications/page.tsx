"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { notificationActionsFor, type NotificationActionSpec } from "@platform/shared";
import { apiFetch, ApiError } from "@/lib/api";
import { useSession } from "@/components/session-provider";
import { useLocale } from "@/components/locale-provider";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { notificationText } from "@/lib/notification-text";
import { NOTIFICATION_ACTION_UI } from "@/lib/notification-actions";
import { PushSettings } from "@/components/push-settings";
import { formatDateTime } from "@/lib/dates";
import { AuthRequired } from "@/components/auth-prompt";
import { Loading } from "@/components/loading";

interface NotificationItem {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
  context?: { creatorUsername?: string | null; productTitle?: string | null; paymentStatus?: string | null };
}

/** Takes `t` rather than calling the hook, so it stays a plain function
 *  and the message re-translates when the reader switches language. */
function describe(n: NotificationItem, t: (key: TranslationKey) => string): string {
  return notificationText(n.type, n.payload, t);
}

export default function NotificationsPage() {
  const { user, loading: sessionLoading } = useSession();
  const { t, locale } = useLocale();
  const [notifications, setNotifications] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ notifications: NotificationItem[] }>("/notifications");
      setNotifications(res.notifications);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("notifications.loadError"));
    }
  }, [t]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  async function markRead(id: string) {
    try {
      await apiFetch(`/notifications/${id}/read`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("notifications.updateError"));
    }
  }

  async function markAllRead() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/notifications/read-all", { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("notifications.markAllError"));
    } finally {
      setBusy(false);
    }
  }

  /** Confirm or reject the payment the notification is about, on the spot. */
  async function settle(n: NotificationItem, verb: "confirm" | "reject") {
    const paymentId = typeof n.payload?.paymentId === "string" ? n.payload.paymentId : null;
    if (!paymentId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/payments/${paymentId}/${verb}`, { method: "POST" });
      if (!n.readAt) await apiFetch(`/notifications/${n.id}/read`, { method: "POST" });
      setNotice(verb === "confirm" ? t("notify.paymentConfirmed") : t("notify.paymentRejected"));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("notifications.updateError"));
    } finally {
      setBusy(false);
    }
  }

  async function copyCode(n: NotificationItem) {
    const code = typeof n.payload?.code === "string" ? n.payload.code : null;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopiedId(n.id);
      window.setTimeout(() => setCopiedId((current) => (current === n.id ? null : current)), 1600);
    } catch {
      setError(t("notifications.updateError"));
    }
  }

  if (sessionLoading) return <Loading />;
  if (!user) return <AuthRequired />;

  const hasUnread = notifications?.some((n) => !n.readAt);

  function renderAction(n: NotificationItem, action: NotificationActionSpec) {
    const ui = NOTIFICATION_ACTION_UI[action.id];
    const Icon = ui.icon;
    const label = t(ui.label);
    if (action.href) {
      return (
        <Link
          key={action.id}
          href={action.href}
          className="action-item is-icon"
          title={label}
          aria-label={label}
          onClick={() => {
            if (!n.readAt) void markRead(n.id);
          }}
        >
          <Icon />
        </Link>
      );
    }
    const onClick =
      action.id === "confirm-payment"
        ? () => settle(n, "confirm")
        : action.id === "reject-payment"
          ? () => settle(n, "reject")
          : () => copyCode(n);
    return (
      <button
        key={action.id}
        type="button"
        className={`action-item is-icon${action.id === "reject-payment" ? " is-danger" : ""}`}
        title={label}
        aria-label={label}
        disabled={busy}
        onClick={onClick}
      >
        <Icon />
        {action.id === "copy-code" && copiedId === n.id && <span className="action-toast">{t("notify.copied")}</span>}
      </button>
    );
  }

  return (
    <div className="stack">
      <div className="notifications-head">
        <h1 style={{ margin: 0 }}>{t("notifications.title")}</h1>
        {hasUnread && (
          <button className="secondary" onClick={markAllRead} disabled={busy}>
            {t("notifications.markAllRead")}
          </button>
        )}
      </div>
      <PushSettings />
      {error && <div className="error-banner">{error}</div>}
      {notice && <div className="notice-banner" role="status">{notice}</div>}
      {notifications === null && <Loading />}
      {notifications?.length === 0 && <div className="empty-state">{t("notifications.empty")}</div>}
      {notifications && notifications.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          {notifications.map((n) => {
            const actions = notificationActionsFor(n.type, n.payload, n.context ?? {});
            // A plain tap on the message opens the first place that has an address.
            const primary = actions.find((a) => a.href)?.href;
            return (
              <div key={n.id} className={`card notification-row${n.readAt ? " is-read" : ""}`}>
                <div className="notification-body">
                  {primary ? (
                    <Link
                      href={primary}
                      className="notification-text"
                      onClick={() => {
                        if (!n.readAt) void markRead(n.id);
                      }}
                    >
                      {describe(n, t)}
                    </Link>
                  ) : (
                    <p style={{ margin: 0 }}>{describe(n, t)}</p>
                  )}
                  <span className="lede" style={{ margin: 0, fontSize: "0.8rem" }}>{formatDateTime(n.createdAt, locale)}</span>
                </div>
                {(actions.length > 0 || !n.readAt) && (
                  <div className="notification-actions" role="group" aria-label={t("notify.actions")}>
                    {actions.map((action) => renderAction(n, action))}
                    {!n.readAt && (
                      <button className="link-button notification-mark" onClick={() => markRead(n.id)}>
                        {t("notifications.markRead")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
