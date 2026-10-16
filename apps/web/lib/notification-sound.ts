/**
 * The sound a new notification makes while Cryptovich is open in a tab: one for
 * money — a payment waiting to be confirmed, a donation, a new subscriber,
 * a purchase — and another for everything else. Per browser, on unless
 * the reader turns it off. A tab nobody has clicked in yet stays silent
 * (the browser's autoplay rule); that is the browser's call, not an error.
 */

const SWITCH = "platform_notification_sound";
// The newest notification any tab of this browser has sounded for, so
// three open tabs make one sound, not three.
const HEARD = "platform_notification_heard_at";

const MONEY = new Set(["PAYMENT_MARKED_PAID", "DONATION_RECEIVED", "NEW_SUBSCRIBER", "PRODUCT_PURCHASED"]);

export type NotificationSound = "payment" | "notification";

export interface UnreadAnswer {
  unreadCount: number;
  /** The newest unread, newest first: kind and ISO time. */
  latest: { type: string; createdAt: string }[];
}

export function notificationSoundOn(): boolean {
  try {
    return localStorage.getItem(SWITCH) !== "off";
  } catch {
    return true;
  }
}

export function setNotificationSoundOn(on: boolean): void {
  try {
    if (on) localStorage.removeItem(SWITCH);
    else localStorage.setItem(SWITCH, "off");
  } catch {
    // Storage refused: the switch lasts as long as the page.
  }
}

const players = new Map<NotificationSound, HTMLAudioElement>();

function player(kind: NotificationSound): HTMLAudioElement {
  let audio = players.get(kind);
  if (!audio) {
    audio = new Audio(`/sounds/${kind}.mp3`);
    players.set(kind, audio);
  }
  return audio;
}

export function playNotificationSound(kind: NotificationSound): void {
  const audio = player(kind);
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

/**
 * Plays both sounds silently inside the reader's first click or key press.
 * Safari (on iPhone above all) lets a page play a sound later, unprompted,
 * only through an element that has already played during a gesture.
 */
export function primeNotificationSounds(): void {
  for (const kind of ["notification", "payment"] as const) {
    const audio = player(kind);
    audio.muted = true;
    audio
      .play()
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
      })
      .catch(() => {})
      .finally(() => {
        audio.muted = false;
      });
  }
}

function heardUpTo(): string {
  try {
    return localStorage.getItem(HEARD) ?? "";
  } catch {
    return "";
  }
}

function markHeard(at: string): void {
  try {
    if (at > heardUpTo()) localStorage.setItem(HEARD, at);
  } catch {
    // Without storage each tab sounds on its own.
  }
}

/**
 * Called with every answer of `GET /notifications/unread`. A tab's first
 * answer only marks where "new" begins — opening the site is not a new
 * notification; after that, anything newer sounds once. Times are the
 * server's ISO strings, compared with each other only.
 */
export function soundForNew(latest: UnreadAnswer["latest"], seen: { current: string | undefined }): void {
  const newest = latest[0]?.createdAt ?? "";
  const since = seen.current;
  seen.current = since === undefined || newest > since ? newest : since;
  if (since === undefined) {
    markHeard(newest);
    return;
  }
  const heard = heardUpTo();
  const fresh = latest.filter((n) => n.createdAt > since && n.createdAt > heard);
  if (fresh.length === 0) return;
  markHeard(newest);
  if (notificationSoundOn()) playNotificationSound(fresh.some((n) => MONEY.has(n.type)) ? "payment" : "notification");
}
