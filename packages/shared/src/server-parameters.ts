import { parseDomainList } from "./federation-policy.js";

/**
 * Every setting an administrator can change from the admin area
 * ("Редактирование параметров"), stored in the `ServerSetting` table.
 *
 * Until one is saved there, a setting is the `.env` variable of the same
 * meaning, then its built-in default — so an installation whose admin
 * never opens the page keeps what its `.env` says, and a value saved there
 * wins over `.env` from then on. Pure data and rules: the API (reads,
 * writes, the admin table) and the worker (birthdays, Telegram imports)
 * both read the same rows through them.
 *
 * What is not here is server-only on purpose (`SERVER_ONLY_PARAMETERS`):
 * the database and Redis are needed before this table can be read, and
 * the site's address, the proxy it trusts, where uploads live and the
 * push keys cannot change under a running server without breaking it.
 */

export type ParameterKind = "choice" | "boolean" | "integer" | "text" | "domains" | "secret";

export type ParameterGroup =
  | "registration"
  | "security"
  | "access"
  | "search"
  | "federation"
  | "files"
  | "posts"
  | "email"
  | "branding"
  | "integrations"
  | "notifications";

export const PARAMETER_GROUPS: readonly ParameterGroup[] = [
  "registration",
  "security",
  "access",
  "search",
  "federation",
  "files",
  "posts",
  "email",
  "branding",
  "integrations",
  "notifications",
];

/** Why a value was refused — a code the admin page words in each language. */
export type ParameterProblem = "choice" | "boolean" | "integer" | "range" | "text" | "domains" | "format";

interface ParameterDefinition {
  group: ParameterGroup;
  kind: ParameterKind;
  /** The `.env` variable that is the value while nothing is saved. */
  env?: string;
  /** The value with neither a saved one nor `.env`. */
  fallback: string;
  values?: readonly string[];
  min?: number;
  max?: number;
  /** A rule beyond the kind's own. */
  check?: (value: string) => boolean;
}

const SMTP_URL = /^smtps?:\/\/[^\s]+$/i;
const MAILBOX = /^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$/;
const TELEGRAM_TOKEN = /^\d{5,}:[A-Za-z0-9_-]{20,}$/;
const HOST_PATTERN = /^\.?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;

export const SERVER_PARAMETERS = {
  registrationMode: { group: "registration", kind: "choice", values: ["invite", "open"], env: "REGISTRATION_MODE", fallback: "invite" },
  registrationBotCheck: { group: "registration", kind: "boolean", env: "REGISTRATION_BOT_CHECK", fallback: "true" },
  registrationPowBits: { group: "registration", kind: "integer", min: 8, max: 26, env: "REGISTRATION_POW_BITS", fallback: "18" },
  adminRequire2fa: { group: "security", kind: "boolean", env: "ADMIN_REQUIRE_2FA", fallback: "true" },
  apiAccessMode: { group: "access", kind: "choice", values: ["contribution", "free"], fallback: "contribution" },
  // The whole server out of search engines: every page says noindex and
  // robots.txt turns crawlers away. Each author can also hide only their own.
  hideFromSearchEngines: { group: "search", kind: "boolean", env: "HIDE_FROM_SEARCH_ENGINES", fallback: "false" },
  federationEnabled: { group: "federation", kind: "boolean", fallback: "true" },
  federationMode: { group: "federation", kind: "choice", values: ["open", "allowlist"], env: "FEDERATION_MODE", fallback: "open" },
  federationAllowedDomains: { group: "federation", kind: "domains", env: "FEDERATION_ALLOWED_DOMAINS", fallback: "" },
  federationBlockedDomains: { group: "federation", kind: "domains", env: "FEDERATION_BLOCKED_DOMAINS", fallback: "" },
  maxUploadBytes: { group: "files", kind: "integer", min: 64 * 1024, max: 1024 * 1024 * 1024, env: "MAX_UPLOAD_BYTES", fallback: String(5 * 1024 * 1024) },
  // An administrator's own uploads: announcements' pictures, stickers,
  // their posts — their own server, a limit of its own.
  adminMaxUploadBytes: { group: "files", kind: "integer", min: 64 * 1024, max: 1024 * 1024 * 1024, env: "ADMIN_MAX_UPLOAD_BYTES", fallback: String(50 * 1024 * 1024) },
  // How long a post's text may be, counted as the editor counts it.
  postMaxChars: { group: "posts", kind: "integer", min: 100, max: 50000, env: "POST_MAX_CHARS", fallback: "1200" },
  smtpUrl: { group: "email", kind: "secret", env: "SMTP_URL", fallback: "", check: (v) => SMTP_URL.test(v) },
  emailFrom: {
    group: "email",
    kind: "text",
    env: "EMAIL_FROM",
    fallback: "Cryptovich <no-reply@localhost>",
    // "Name <box@host>" or a bare address; never a line break, which would
    // let a value write headers of its own.
    check: (v) => MAILBOX.test(v) || /^[^<>\r\n]*<[^<>@\s]+@[^<>@\s]+>$/.test(v),
  },
  favicon: {
    group: "branding",
    kind: "text",
    env: "FAVICON",
    fallback: "",
    // What the branding module can read: an https address, or a file in
    // the read-only ./branding mount.
    check: (v) => /^https:\/\/\S+$/i.test(v) || /^\/branding\/[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(v),
  },
  telegramBotToken: { group: "integrations", kind: "secret", env: "TELEGRAM_BOT_TOKEN", fallback: "", check: (v) => TELEGRAM_TOKEN.test(v) },
  // The same bot as a bridge: members link their Telegram, receive new
  // posts there and (if they choose) publish by writing to it.
  telegramBridge: { group: "integrations", kind: "boolean", env: "TELEGRAM_BRIDGE", fallback: "false" },
  birthdayNotifyHourUtc: { group: "notifications", kind: "integer", min: 0, max: 23, env: "BIRTHDAY_NOTIFY_HOUR_UTC", fallback: "9" },
} as const satisfies Record<string, ParameterDefinition>;

export type ServerParameterKey = keyof typeof SERVER_PARAMETERS;
export const SERVER_PARAMETER_KEYS = Object.keys(SERVER_PARAMETERS) as ServerParameterKey[];

export function isServerParameterKey(key: string): key is ServerParameterKey {
  return Object.prototype.hasOwnProperty.call(SERVER_PARAMETERS, key);
}

export function parameterDefinition(key: ServerParameterKey): ParameterDefinition {
  return SERVER_PARAMETERS[key];
}

export type ParameterCheck = { ok: true; value: string } | { ok: false; problem: ParameterProblem };

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * The value `raw` stands for, in the one form it is stored in — or why it
 * cannot be one. An empty text, list or secret is allowed: it means "none".
 */
export function normaliseParameter(key: ServerParameterKey, raw: unknown): ParameterCheck {
  const def: ParameterDefinition = SERVER_PARAMETERS[key];
  switch (def.kind) {
    case "choice": {
      const value = String(raw ?? "").trim();
      return def.values!.includes(value) ? { ok: true, value } : { ok: false, problem: "choice" };
    }
    case "boolean": {
      const value = String(raw ?? "").trim().toLowerCase();
      return value === "true" || value === "false" ? { ok: true, value } : { ok: false, problem: "boolean" };
    }
    case "integer": {
      const text = String(raw ?? "").trim();
      if (!/^\d+$/.test(text)) return { ok: false, problem: "integer" };
      const n = Number(text);
      if (n < def.min! || n > def.max!) return { ok: false, problem: "range" };
      return { ok: true, value: String(n) };
    }
    case "domains": {
      const text = Array.isArray(raw) ? raw.join(",") : String(raw ?? "");
      if (CONTROL.test(text.replace(/[\r\n\t]/g, " "))) return { ok: false, problem: "domains" };
      const hosts = parseDomainList(text);
      if (hosts.some((host) => !HOST_PATTERN.test(host))) return { ok: false, problem: "domains" };
      return { ok: true, value: [...new Set(hosts)].join(", ") };
    }
    case "text":
    case "secret": {
      if (typeof raw !== "string" && typeof raw !== "number") return { ok: false, problem: "text" };
      const value = String(raw).trim();
      if (value === "") return { ok: true, value };
      if (CONTROL.test(value) || value.length > (def.kind === "secret" ? 1000 : 300)) return { ok: false, problem: "text" };
      if (def.check && !def.check(value)) return { ok: false, problem: "format" };
      return { ok: true, value };
    }
  }
}

export type ParameterSource = "stored" | "env" | "default";

/** A post's length as the limit counts it: characters, not UTF-16 units — an emoji is one. */
export function postLength(text: string): number {
  return Array.from(text).length;
}

/**
 * What `.env` says, read the forgiving way it always was: a switch is on
 * unless it says "false", and a value that does not fit is no value.
 */
function fromEnv(key: ServerParameterKey, env: Record<string, string | undefined>): string | null {
  const def: ParameterDefinition = SERVER_PARAMETERS[key];
  const raw = def.env ? env[def.env] : undefined;
  if (raw === undefined || raw.trim() === "") return null;
  if (def.kind === "boolean") return raw.trim().toLowerCase() === "false" ? "false" : "true";
  const checked = normaliseParameter(key, raw);
  return checked.ok ? checked.value : null;
}

/** The value in force: saved, else `.env`, else built in — each only if valid. */
export function effectiveParameter(
  key: ServerParameterKey,
  stored: string | undefined,
  env: Record<string, string | undefined>,
): { value: string; source: ParameterSource } {
  if (stored !== undefined) {
    const checked = normaliseParameter(key, stored);
    if (checked.ok) return { value: checked.value, source: "stored" };
  }
  const value = fromEnv(key, env);
  if (value !== null) return { value, source: "env" };
  return { value: SERVER_PARAMETERS[key].fallback, source: "default" };
}

/**
 * Settings that stay in `.env`, shown read-only beside the rest so the
 * table is the whole picture. `reason` is a code the page words.
 */
export const SERVER_ONLY_PARAMETERS = [
  { env: "WEB_ORIGIN", reason: "address", secret: false },
  { env: "API_PUBLIC_URL", reason: "address", secret: false },
  { env: "TRUST_PROXY", reason: "network", secret: false },
  { env: "COOKIE_SECURE", reason: "network", secret: false },
  { env: "DATABASE_URL", reason: "startup", secret: true },
  { env: "REDIS_URL", reason: "startup", secret: true },
  { env: "UPLOAD_DIR", reason: "storage", secret: false },
  { env: "S3_BUCKET", reason: "storage", secret: false },
  { env: "S3_ENDPOINT", reason: "storage", secret: false },
  { env: "S3_REGION", reason: "storage", secret: false },
  { env: "S3_ACCESS_KEY_ID", reason: "storage", secret: true },
  { env: "S3_SECRET_ACCESS_KEY", reason: "storage", secret: true },
  { env: "VAPID_PUBLIC_KEY", reason: "keys", secret: false },
  { env: "VAPID_PRIVATE_KEY", reason: "keys", secret: true },
  { env: "ADMIN_USERNAME", reason: "firstRun", secret: false },
  { env: "ADMIN_PASSWORD", reason: "firstRun", secret: true },
  { env: "ADMIN_BOOTSTRAP", reason: "firstRun", secret: false },
  { env: "REPROCESS_IMAGES_ON_START", reason: "containerStart", secret: false },
  { env: "APP_VERSION", reason: "containerStart", secret: false },
  { env: "SENTRY_DSN", reason: "allProcesses", secret: true },
  { env: "SENTRY_ENVIRONMENT", reason: "allProcesses", secret: false },
  { env: "API_PORT", reason: "compose", secret: false },
  { env: "NODE_ENV", reason: "compose", secret: false },
] as const;

export type ServerOnlyReason = (typeof SERVER_ONLY_PARAMETERS)[number]["reason"];

/** The format an export file is written in, so an import can tell one from anything else. */
export const PARAMETERS_EXPORT_FORMAT = "cryptovich-parameters";
/** What a file exported before the project was renamed says it is; still read. */
export const LEGACY_PARAMETERS_EXPORT_FORMATS: readonly string[] = ["4tip-parameters"];
