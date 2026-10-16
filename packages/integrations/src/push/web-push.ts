import webpush from "web-push";

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushResult =
  | { ok: true }
  /** `gone`: the browser unsubscribed or the subscription expired — delete it. */
  | { ok: false; gone: boolean; status: number | null; error: string };

export function generateVapidKeys(): VapidKeys {
  return webpush.generateVAPIDKeys();
}

/**
 * The push services browsers actually use. A subscription's endpoint is a
 * URL the *browser* hands over, which means a person can hand over any URL
 * — so the server only ever sends to these hosts, never to an address
 * inside its own network (the SSRF a push endpoint would otherwise be).
 */
const PUSH_SERVICE_HOSTS = [
  "fcm.googleapis.com", // Chrome, Edge, Opera, Brave, Android
  "updates.push.services.mozilla.com", // Firefox
  "web.push.apple.com", // Safari (macOS, iOS 16.4+)
  ".push.apple.com",
  ".notify.windows.com", // legacy Edge / Windows
  "push.services.mozilla.com",
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "") return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.some((allowed) => (allowed.startsWith(".") ? host.endsWith(allowed) : host === allowed));
}

/**
 * Sends one encrypted message to one browser, through its push service.
 * The payload is encrypted to that browser's keys (RFC 8291); the push
 * service carries it without being able to read it. The request is signed
 * with this server's VAPID key (RFC 8292).
 */
export class WebPushSender {
  constructor(
    private readonly vapid: VapidKeys,
    /** Who runs this server: an https URL or a mailto: address. */
    private readonly subject: string,
  ) {}

  async send(target: PushTarget, payload: object, options: { ttlSeconds?: number } = {}): Promise<PushResult> {
    if (!isAllowedPushEndpoint(target.endpoint)) {
      return { ok: false, gone: true, status: null, error: "Not a browser push service." };
    }
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
        {
          vapidDetails: { subject: this.subject, publicKey: this.vapid.publicKey, privateKey: this.vapid.privateKey },
          TTL: options.ttlSeconds ?? 24 * 60 * 60,
          timeout: 10_000,
        },
      );
      return { ok: true };
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode ?? null;
      return {
        ok: false,
        // 404/410: the subscription no longer exists at the push service.
        gone: status === 404 || status === 410,
        status,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
