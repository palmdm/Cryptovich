/**
 * When the two offers — install Cryptovich as an app, turn on browser
 * notifications — may appear. They were two large cards, both at once, on
 * the first visit, back two weeks after "Not now". Now:
 *
 *  - never on a reader's first visit (a visit is a browser session);
 *  - one offer per visit at most, never both;
 *  - "Later" keeps that offer away for two months, and a second "Later"
 *    for good. Both stay a click away regardless: installing in the
 *    "More" menu, notifications in the notifications settings.
 *
 * Storage is passed in so the rules can be tested without a browser.
 */
export type Nudge = "install" | "push";

export interface NudgeStorage {
  local: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  session: Pick<Storage, "getItem" | "setItem">;
}

const VISITS_KEY = "platform_visits";
const VISIT_COUNTED_KEY = "platform_visit_counted";
const SHOWN_THIS_VISIT_KEY = "platform_nudge_this_visit";
const laterKey = (nudge: Nudge) => `platform_nudge_later_${nudge}`;
/** The two-week dismissals from before; read once as a first "Later". */
const LEGACY_KEYS: Record<Nudge, string> = {
  install: "platform_install_dismissed_at",
  push: "platform_push_prompt_dismissed_at",
};

export const SNOOZE_MS = 60 * 24 * 60 * 60 * 1000;
/** The first visit is the reader's own; offers wait for the second. */
export const MIN_VISITS = 2;

interface Later {
  count: number;
  at: number;
}

function readLater(store: NudgeStorage, nudge: Nudge): Later | null {
  const raw = store.local.getItem(laterKey(nudge));
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Later;
      if (Number.isFinite(parsed.count) && Number.isFinite(parsed.at)) return parsed;
    } catch {
      // Unreadable: as if never answered.
    }
  }
  const legacy = Number(store.local.getItem(LEGACY_KEYS[nudge]));
  if (Number.isFinite(legacy) && legacy > 0) return { count: 1, at: legacy };
  return null;
}

/** Counts this visit once, however many pages it opens. */
export function countVisit(store: NudgeStorage): number {
  const visits = Number(store.local.getItem(VISITS_KEY)) || 0;
  if (store.session.getItem(VISIT_COUNTED_KEY)) return visits;
  store.session.setItem(VISIT_COUNTED_KEY, "1");
  store.local.setItem(VISITS_KEY, String(visits + 1));
  return visits + 1;
}

export function nudgeAllowed(store: NudgeStorage, nudge: Nudge, now: number): boolean {
  if ((Number(store.local.getItem(VISITS_KEY)) || 0) < MIN_VISITS) return false;
  const shown = store.session.getItem(SHOWN_THIS_VISIT_KEY);
  if (shown && shown !== nudge) return false;
  const later = readLater(store, nudge);
  if (!later) return true;
  if (later.count >= 2) return false;
  return now - later.at >= SNOOZE_MS;
}

/** The offer on screen this visit; the other waits for another one. */
export function markShown(store: NudgeStorage, nudge: Nudge): void {
  store.session.setItem(SHOWN_THIS_VISIT_KEY, nudge);
}

export function answerLater(store: NudgeStorage, nudge: Nudge, now: number): void {
  const previous = readLater(store, nudge);
  store.local.setItem(laterKey(nudge), JSON.stringify({ count: (previous?.count ?? 0) + 1, at: now }));
  store.local.removeItem(LEGACY_KEYS[nudge]);
}

/** The browser's storage, or nothing at all when it refuses (private modes). */
export function browserNudgeStorage(): NudgeStorage | null {
  try {
    const probe = "platform_probe";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return { local: window.localStorage, session: window.sessionStorage };
  } catch {
    return null;
  }
}
