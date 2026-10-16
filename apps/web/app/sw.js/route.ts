import { LOCALES } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/all";
import { NOTIFICATION_TEXT } from "@/lib/notification-text";

/**
 * The service worker, generated rather than a static file so it words a
 * push exactly as the notifications page does: the same rules
 * (lib/notification-text.ts) and the same en/ru/ja dictionaries, embedded
 * as data. What it does is described at the top of the script itself.
 */
export const dynamic = "force-static";

const keys = [
  ...new Set(
    Object.values(NOTIFICATION_TEXT).flatMap((rule) => [
      rule.key,
      ...(rule.cancelledKey ? [rule.cancelledKey] : []),
      ...(rule.missingKey ? [rule.missingKey] : []),
      ...Object.values(rule.phrases ?? {}),
    ]),
  ),
];
const texts = Object.fromEntries(LOCALES.map((locale) => [locale, Object.fromEntries(keys.map((key) => [key, dictionaries[locale][key]]))]));

const script = `/*
 * Cryptovich's service worker. It does three things and nothing else:
 *
 *  - makes the site installable as an app, and shows a small offline page
 *    when a page is opened with no connection;
 *  - shows a notification pushed by the server (Web Push), in the reader's
 *    language, and opens the right page when it is clicked;
 *  - never caches pages, API responses or files: everything a reader sees
 *    comes fresh from the server, which decides who may read what.
 */
const RULES = ${JSON.stringify(NOTIFICATION_TEXT)};
const TEXTS = ${JSON.stringify(texts)};

function pickLocale(requested) {
  if (requested && TEXTS[requested]) return requested;
  const browser = (self.navigator && self.navigator.language ? self.navigator.language : "en").slice(0, 2);
  return TEXTS[browser] ? browser : "en";
}

function describe(type, data, locale) {
  const rule = RULES[type];
  const t = (key) => TEXTS[locale][key] || TEXTS.en[key] || key;
  if (!rule) return "";
  if (rule.ownField && typeof data[rule.ownField] === "string" && data[rule.ownField]) return data[rule.ownField];
  const phrase = rule.byField && rule.phrases ? rule.phrases[String(data[rule.byField])] : undefined;
  if (phrase) return t(phrase).replace("{name}", String((rule.nameField && data[rule.nameField]) || data.creatorUsername || ""));
  const value = rule.field ? (data[rule.field] != null ? data[rule.field] : rule.fallbackField ? data[rule.fallbackField] : undefined) : undefined;
  const missing = value == null || value === "";
  if (rule.missingKey && missing) return t(rule.missingKey);
  let text = t(rule.cancelledKey && data.cancelled ? rule.cancelledKey : rule.key);
  if (rule.field) text += (rule.joiner || " ") + (missing ? "" : String(value));
  if (rule.codeField) text += " — " + String(data[rule.codeField] == null ? "" : data[rule.codeField]);
  return text;
}

// Renamed whenever what it holds changes: v1 kept the icon drawn while the
// built-in mark still depended on a font, a green square with a speck.
const SHELL_CACHE = "cryptovich-shell-v3";
const SHELL = ["/offline.html", "/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Only page navigations, and only when the network fails: then the offline
// page, from the one small cache above. Everything else goes to the network
// untouched.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match("/offline.html")));
});

self.addEventListener("push", (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = { body: event.data ? event.data.text() : "" };
  }
  const locale = pickLocale(message.locale);
  const title = message.title || "Cryptovich";
  const body = message.body || (message.type ? describe(message.type, message.data || {}, locale) : "");
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: message.tag || undefined,
        lang: locale,
        data: { url: message.url || "/notifications" },
      }),
      // An open tab updates its badge (and plays its sound) now rather
      // than at its next half-minute check.
      self.clients.matchAll({ type: "window" }).then((windows) => {
        for (const client of windows) client.postMessage({ type: "cryptovich:notification" });
      }),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/notifications", self.location.origin);
  // Only this site's own pages: a notification never opens elsewhere.
  if (url.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ("focus" in client) {
          client.navigate(url.href);
          return client.focus();
        }
      }
      return self.clients.openWindow(url.href);
    }),
  );
});
`;

export function GET() {
  return new Response(script, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // Always checked for a newer version, the way browsers expect a
      // service worker to be.
      "Cache-Control": "no-cache",
    },
  });
}
