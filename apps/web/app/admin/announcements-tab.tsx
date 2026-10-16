"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, localizedErrorMessage } from "@/lib/api";
import { useLocale } from "@/components/locale-provider";
import { RichText } from "@/components/rich-text";
import { formatDateTime } from "@/lib/dates";

interface AdminAnnouncement {
  id: string;
  text: string | null;
  version: string | null;
  startsAt: string;
  endsAt: string | null;
}

/** An input value for <input type="datetime-local"> from a date. */
function localInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/**
 * Writing the announcements readers see over the page. The "what's new in
 * vX" ones are made by the server on each update; they can be deleted here
 * like any other, and are not made again.
 */
export function AnnouncementsTab() {
  const { t, locale } = useLocale();
  const [items, setItems] = useState<AdminAnnouncement[] | null>(null);
  const [text, setText] = useState("");
  const [startsAt, setStartsAt] = useState(() => localInput(new Date()));
  const [endsAt, setEndsAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems((await apiFetch<{ announcements: AdminAnnouncement[] }>("/admin/announcements")).announcements);
    } catch (err) {
      setError(localizedErrorMessage(err, t, "common.genericError"));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  async function publish(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/admin/announcements", {
        method: "POST",
        body: JSON.stringify({
          text,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: endsAt ? new Date(endsAt).toISOString() : null,
        }),
      });
      setText("");
      setEndsAt("");
      await load();
    } catch (err) {
      setError(localizedErrorMessage(err, t, "common.genericError"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("admin.announcementDeleteConfirm"))) return;
    try {
      await apiFetch(`/admin/announcements/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(localizedErrorMessage(err, t, "common.genericError"));
    }
  }

  return (
    <div className="stack">
      <form className="card stack" onSubmit={publish}>
        <h2 style={{ margin: 0 }}>{t("admin.announcementNew")}</h2>
        {error && <div className="error-banner">{error}</div>}
        <div className="form-field">
          <label htmlFor="announcement-text">{t("admin.announcementText")}</label>
          <textarea id="announcement-text" rows={5} maxLength={5000} required value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="form-field">
            <label htmlFor="announcement-starts">{t("admin.announcementStarts")}</label>
            <input id="announcement-starts" type="datetime-local" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </div>
          <div className="form-field">
            <label htmlFor="announcement-ends">{t("admin.announcementEnds")}</label>
            <input id="announcement-ends" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </div>
        </div>
        <button className="primary" type="submit" disabled={busy || !text.trim()} style={{ width: "fit-content" }}>
          {t("admin.announcementPublish")}
        </button>
      </form>

      {items?.length === 0 && <div className="empty-state">{t("admin.announcementsEmpty")}</div>}
      {items?.map((a) => (
        <article key={a.id} className="card stack" style={{ gap: 8 }}>
          <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
            <span className="meta">
              {formatDateTime(a.startsAt, locale)}
              {a.endsAt ? ` — ${formatDateTime(a.endsAt, locale)}` : ""}
            </span>
            <button type="button" className="danger" onClick={() => remove(a.id)}>
              {t("admin.announcementDelete")}
            </button>
          </div>
          {a.text ? (
            <RichText text={a.text} creatorUsername="" />
          ) : (
            <p className="meta" style={{ margin: 0 }}>
              {t("admin.announcementVersion", { version: a.version ?? "" })}
            </p>
          )}
        </article>
      ))}
    </div>
  );
}
