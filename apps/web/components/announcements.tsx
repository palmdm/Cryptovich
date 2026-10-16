"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiFetch, ApiError, localizedErrorMessage } from "@/lib/api";
import { useSession } from "./session-provider";
import { en, type TranslationKey } from "@/lib/i18n/en";
import { useLocale } from "./locale-provider";
import { useAuthPrompt } from "./auth-prompt";
import { RichText } from "./rich-text";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, MegaphoneIcon, PlusIcon, SmileIcon } from "./icons";

interface Reaction {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface Announcement {
  id: string;
  text: string | null;
  version: string | null;
  /** The version's section of CHANGELOG.md, when it has one. */
  notes?: string | null;
  publishedAt: string;
  reactions: Reaction[];
}

const SEEN_KEY = "platform_seen_announcements";
/** A few of the ones Mastodon puts first; the full picker comes later. */
const QUICK_EMOJI = ["👍", "❤️", "🎉", "😂", "😮", "🔥", "🙏", "👀"];

function readSeen(): Set<string> {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeSeen(ids: Iterable<string>) {
  try {
    // The newest few hundred are plenty: older ones have ended long ago.
    window.localStorage.setItem(SEEN_KEY, JSON.stringify([...ids].slice(-300)));
  } catch {
    // Private mode: they show again next visit, nothing worse.
  }
}

interface AnnouncementsState {
  announcements: Announcement[];
  unseen: number;
  open: boolean;
  setOpen: (open: boolean) => void;
  /** The one a notification's link names (`/?announcement=<id>`). */
  focusId: string | null;
  reload: () => Promise<void>;
}

const AnnouncementsContext = createContext<AnnouncementsState>({
  announcements: [],
  unseen: 0,
  open: false,
  setOpen: () => {},
  focusId: null,
  reload: async () => {},
});

/**
 * The server's announcements, loaded once for the whole page. They open by
 * themselves when one has not been seen in this browser yet — on a first
 * visit, and after an update, which adds a "Cryptovich was updated" one — and
 * the megaphone in the header opens them again.
 */
export function AnnouncementsProvider({ children }: { children: React.ReactNode }) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [open, setOpenState] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const [focusId, setFocusId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await apiFetch<{ announcements: Announcement[] }>("/announcements");
      setAnnouncements(res.announcements);
      const seen = readSeen();
      const fresh = res.announcements.filter((a) => !seen.has(a.id)).length;
      setUnseen(fresh);
      if (fresh > 0) setOpenState(true);
    } catch {
      // No announcements to show is the same as none.
    }
  }, []);

  useEffect(() => {
    void reload();
    // Opened from a notification: show that one.
    const wanted = new URLSearchParams(window.location.search).get("announcement");
    if (wanted) {
      setFocusId(wanted);
      setOpenState(true);
    }
  }, [reload]);

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      if (!next) {
        // Closing marks them all read, as Mastodon's dismiss does.
        const seen = readSeen();
        for (const a of announcements) seen.add(a.id);
        writeSeen(seen);
        setUnseen(0);
      }
    },
    [announcements],
  );

  const value = useMemo(() => ({ announcements, unseen, open, setOpen, focusId, reload }), [announcements, unseen, open, setOpen, focusId, reload]);
  return <AnnouncementsContext.Provider value={value}>{children}</AnnouncementsContext.Provider>;
}

export function useAnnouncements() {
  return useContext(AnnouncementsContext);
}

/** The header's megaphone: shown only when there is something to announce. */
export function AnnouncementsButton() {
  const { t } = useLocale();
  const { user } = useSession();
  const { announcements, unseen, open, setOpen } = useAnnouncements();
  // An administrator writes them here, so the megaphone is theirs even with none.
  if (announcements.length === 0 && user?.role !== "ADMIN") return null;
  return (
    <button
      type="button"
      className={`topbar-icon-button${open ? " active" : ""}`}
      aria-label={t("announce.open")}
      title={t("announce.open")}
      aria-expanded={open}
      onClick={() => setOpen(!open)}
    >
      <MegaphoneIcon size={19} />
      {unseen > 0 && <span className="topbar-dot" aria-hidden="true" />}
    </button>
  );
}

function releaseNotesKey(version: string): TranslationKey | null {
  const key = `release.${version}`;
  return key in en ? (key as TranslationKey) : null;
}

/** The panel itself, above the page's own content. */
export function AnnouncementsPanel() {
  const { t, locale } = useLocale();
  const { requireAccount } = useAuthPrompt();
  const { user } = useSession();
  const isAdmin = user?.role === "ADMIN";
  const { announcements, open, setOpen, focusId, reload } = useAnnouncements();
  const [index, setIndex] = useState(0);
  const [items, setItems] = useState<Announcement[]>([]);
  const [picking, setPicking] = useState(false);
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setItems(announcements), [announcements]);
  useEffect(() => {
    if (index >= items.length) setIndex(0);
  }, [items.length, index]);
  useEffect(() => {
    const at = focusId ? items.findIndex((a) => a.id === focusId) : -1;
    if (at >= 0) setIndex(at);
  }, [focusId, items]);

  async function publish(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/admin/announcements", { method: "POST", body: JSON.stringify({ text: draft.trim() }) });
      setDraft("");
      setWriting(false);
      await reload();
      setIndex(0);
    } catch (err) {
      setError(err instanceof ApiError ? localizedErrorMessage(err, t, "announce.publishError") : t("announce.publishError"));
    } finally {
      setBusy(false);
    }
  }

  if (!open || (items.length === 0 && !isAdmin)) return null;

  // An administrator's quick "new announcement": everyone gets it in their
  // notifications too (the server sends them).
  const compose = isAdmin ? (
    writing ? (
      <form className="announcements-compose stack" style={{ gap: 8 }} onSubmit={publish}>
        <label htmlFor="announcement-draft" className="visually-hidden">
          {t("announce.newLabel")}
        </label>
        <textarea
          id="announcement-draft"
          rows={3}
          maxLength={2000}
          value={draft}
          autoFocus
          placeholder={t("announce.newPlaceholder")}
          onChange={(e) => setDraft(e.target.value)}
        />
        <p className="meta" style={{ margin: 0 }}>{t("announce.newHint")}</p>
        {error && <div className="error-banner">{error}</div>}
        <div className="row" style={{ gap: 8 }}>
          <button type="submit" className="primary" disabled={busy || !draft.trim()}>
            {busy ? t("announce.publishing") : t("announce.publish")}
          </button>
          <button type="button" className="secondary" onClick={() => setWriting(false)} disabled={busy}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    ) : (
      <button type="button" className="link-button announcements-new" onClick={() => setWriting(true)}>
        <PlusIcon size={15} />
        {t("announce.new")}
      </button>
    )
  ) : null;

  if (items.length === 0) {
    return (
      <section className="announcements" aria-label={t("announce.open")}>
        <button type="button" className="announcements-close" aria-label={t("announce.close")} title={t("announce.close")} onClick={() => setOpen(false)}>
          <CloseIcon size={18} />
        </button>
        <div className="announcements-head">
          <MegaphoneIcon size={16} />
          <strong>{t("announce.label")}</strong>
        </div>
        {compose}
      </section>
    );
  }
  const current = items[index]!;

  const date = new Date(current.publishedAt).toLocaleString(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  // The operator's changelog first; a version from before it existed keeps
  // the translated notes it shipped with.
  const notesKey = current.version ? releaseNotesKey(current.version) : null;
  const notes = current.notes ?? (notesKey ? t(notesKey) : null);
  const body = current.text
    ? current.text
    : `${t("announce.updated").replace("{version}", current.version ?? "")}${notes ? `\n\n${notes}` : ""}`;

  async function react(emoji: string) {
    setPicking(false);
    if (!requireAccount()) return;
    try {
      const res = await apiFetch<{ announcement: Announcement }>(`/announcements/${current.id}/reactions`, {
        method: "POST",
        body: JSON.stringify({ emoji }),
      });
      setItems((prev) => prev.map((a) => (a.id === current.id ? { ...a, reactions: res.announcement.reactions } : a)));
    } catch {
      // The unchanged count is the answer; nothing to interrupt the reader with.
    }
  }

  return (
    <section className="announcements" aria-label={t("announce.open")} aria-live="polite">
      <button type="button" className="announcements-close" aria-label={t("announce.close")} title={t("announce.close")} onClick={() => setOpen(false)}>
        <CloseIcon size={18} />
      </button>
      <div className="announcements-head">
        <MegaphoneIcon size={16} />
        <strong>{t("announce.label")}</strong>
        <span className="meta">· {date}</span>
      </div>
      <div className="announcements-body">
        <RichText text={body} creatorUsername="" />
      </div>
      <div className="announcements-foot">
        <div className="announcements-reactions">
          {current.reactions.map((r) => (
            <button
              key={r.emoji}
              type="button"
              className={`announce-reaction${r.mine ? " mine" : ""}`}
              aria-pressed={r.mine}
              onClick={() => react(r.emoji)}
            >
              <span>{r.emoji}</span>
              <span className="announce-reaction-count">{r.count}</span>
            </button>
          ))}
          <span className="announce-picker-anchor">
            <button
              type="button"
              className="announce-reaction add"
              aria-label={t("announce.react")}
              title={t("announce.react")}
              aria-expanded={picking}
              onClick={() => requireAccount() && setPicking((v) => !v)}
            >
              <SmileIcon size={16} />
            </button>
            {picking && (
              <span className="announce-picker" role="menu">
                {QUICK_EMOJI.map((emoji) => (
                  <button key={emoji} type="button" role="menuitem" onClick={() => react(emoji)}>
                    {emoji}
                  </button>
                ))}
              </span>
            )}
          </span>
        </div>
        {compose && !writing && compose}
        {items.length > 1 && (
          <div className="announcements-pager">
            <button type="button" aria-label={t("announce.prev")} onClick={() => setIndex((i) => (i - 1 + items.length) % items.length)}>
              <ChevronLeftIcon size={16} />
            </button>
            <span className="meta">
              {index + 1} / {items.length}
            </span>
            <button type="button" aria-label={t("announce.next")} onClick={() => setIndex((i) => (i + 1) % items.length)}>
              <ChevronRightIcon size={16} />
            </button>
          </div>
        )}
      </div>
      {writing && compose}
    </section>
  );
}
