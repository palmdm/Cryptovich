export type DeviceKind = "desktop" | "phone" | "tablet" | "other";

export interface DescribedAgent {
  /** "Firefox 128", "curl 8" — the product's own name, so never translated. */
  browser: string | null;
  /** "Windows", "Android 14", "macOS" … */
  os: string | null;
  kind: DeviceKind;
}

// Most specific first: Edge, Opera and Yandex all say "Chrome/…" too, and
// Chrome says "Safari/…".
const BROWSERS: [RegExp, string][] = [
  [/(?:Edg|EdgA|EdgiOS|Edge)\/(\d+)/, "Edge"],
  [/(?:OPR|OPT|Opera)\/(\d+)/, "Opera"],
  [/YaBrowser\/(\d+)/, "Yandex Browser"],
  [/SamsungBrowser\/(\d+)/, "Samsung Internet"],
  [/Vivaldi\/(\d+)/, "Vivaldi"],
  [/(?:Firefox|FxiOS)\/(\d+)/, "Firefox"],
  [/Chromium\/(\d+)/, "Chromium"],
  [/(?:Chrome|CriOS)\/(\d+)/, "Chrome"],
  [/Version\/(\d+)[^ ]* (?:Mobile\/\S+ )?Safari\//, "Safari"],
  [/curl\/(\d+)/, "curl"],
  [/(?:python-requests|Python-urllib|aiohttp)\/(\d+)/, "Python"],
  [/okhttp\/(\d+)/, "OkHttp"],
  [/PostmanRuntime\/(\d+)/, "Postman"],
];

/**
 * Turns a `User-Agent` header into something a person can recognise their
 * own device by. The raw header is kept as well — this is a reading aid,
 * not a parser anyone should authorise on.
 */
export function describeUserAgent(userAgent: string | null | undefined): DescribedAgent {
  const ua = userAgent ?? "";
  if (!ua) return { browser: null, os: null, kind: "other" };

  let browser: string | null = null;
  for (const [pattern, name] of BROWSERS) {
    const m = pattern.exec(ua);
    if (m) {
      browser = `${name} ${m[1]}`;
      break;
    }
  }
  if (!browser && /^Mozilla\/.* Safari\//.test(ua)) browser = "Safari";

  let os: string | null = null;
  let kind: DeviceKind = "other";
  const android = /Android (\d+)/.exec(ua);
  const ios = /(iPhone|iPad|iPod)[^)]* OS (\d+)/.exec(ua) ?? /(iPhone|iPad|iPod)/.exec(ua);
  if (android) {
    os = `Android ${android[1]}`;
    kind = /Mobile/.test(ua) ? "phone" : "tablet";
  } else if (ios) {
    const iPad = ios[1] === "iPad";
    os = `${iPad ? "iPadOS" : "iOS"}${ios[2] ? ` ${ios[2]}` : ""}`;
    kind = iPad ? "tablet" : "phone";
  } else if (/Windows NT/.test(ua)) {
    os = "Windows";
    kind = "desktop";
  } else if (/CrOS/.test(ua)) {
    os = "ChromeOS";
    kind = "desktop";
  } else if (/Mac OS X|Macintosh/.test(ua)) {
    os = "macOS";
    kind = "desktop";
  } else if (/Linux|X11/.test(ua)) {
    os = "Linux";
    kind = "desktop";
  }
  return { browser, os, kind };
}
