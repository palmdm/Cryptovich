import type { TranslationKey } from "./i18n/en";
/**
 * Same-origin by default: the web server proxies `/api/*` to the API (see
 * next.config.mjs), so the site works under whatever domain a reverse
 * proxy puts in front of it, with no CORS and no second public port.
 * Set NEXT_PUBLIC_API_URL (at build time) only to talk to an API on
 * another origin — which then has to list this site in WEB_ORIGIN.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api";

/**
 * Turns the server's English sentence into the reader's language
 * (lib/api-messages.ts). Set by the LocaleProvider, which knows the
 * language; until it has, a message stays as it came.
 */
let translateMessage: (message: string) => string = (message) => message;
export function setApiMessageTranslator(translate: (message: string) => string): void {
  translateMessage = translate;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

/**
 * Server messages are English. Errors a reader can actually hit get a
 * code-keyed translation here; anything unmapped falls back to the
 * server's message, and a non-API failure to the caller's own fallback.
 */
const TRANSLATED_ERROR_CODES: Partial<Record<string, TranslationKey>> = {
  AUTHOR_NOT_PAYABLE: "errors.AUTHOR_NOT_PAYABLE",
  RATE_LIMITED: "errors.RATE_LIMITED",
  PIN_LIMIT: "errors.PIN_LIMIT",
  PIN_LIMIT_MAX: "errors.PIN_LIMIT_MAX",
  INVITE_LIMIT: "errors.INVITE_LIMIT",
  REGISTRATION_CHECK_FAILED: "errors.REGISTRATION_CHECK_FAILED",
  REWARD_NOT_HELD: "errors.REWARD_NOT_HELD",
  ADMIN_2FA_REQUIRED: "errors.ADMIN_2FA_REQUIRED",
  QR_NUMBER_MISMATCH: "errors.QR_NUMBER_MISMATCH",
  PASSKEY_FAILED: "errors.PASSKEY_FAILED",
  TOO_MANY_2FA_ATTEMPTS: "errors.TOO_MANY_2FA_ATTEMPTS",
  PARAMETERS_LOCKED: "errors.PARAMETERS_LOCKED",
  TWO_FACTOR_SETUP_NEEDED: "errors.TWO_FACTOR_SETUP_NEEDED",
  PARAMETER_INVALID: "errors.PARAMETER_INVALID",
  INVALID_2FA_CODE: "security.codeMismatch",
};

export function localizedErrorMessage(
  err: unknown,
  t: (key: TranslationKey) => string,
  fallback: TranslationKey,
): string {
  // fetch rejects with a TypeError when no response arrived at all — the
  // server is down, or the browser blocked the request (CORS: the site
  // opened on an origin other than WEB_ORIGIN). "Check your details" would
  // send the reader hunting for a typo that isn't there.
  if (err instanceof TypeError) return t("errors.NETWORK");
  if (!(err instanceof ApiError)) return t(fallback);
  const key = err.code ? TRANSLATED_ERROR_CODES[err.code] : undefined;
  return key ? t(key) : err.message;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      // Only set when there's an actual body — sending `Content-Type:
      // application/json` on a bodyless call (every no-payload POST/DELETE:
      // logout, publish, cancel, go-live, mark-read, ...) makes Fastify's
      // JSON body parser reject it as an empty JSON body and 500, since the
      // header promises a JSON payload that was never sent.
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : null;

  if (!res.ok) {
    const message = body?.error?.message ?? "Something went wrong on our end. Please try again.";
    // Every page that shows `err.message` shows it in the reader's language.
    throw new ApiError(res.status, translateMessage(message), body?.error?.code);
  }

  return body as T;
}

/** Where an upload is: bytes still leaving the browser, or all sent and
 * the server working on them (an image is re-encoded on arrival). */
export type UploadPhase = { stage: "sending"; fraction: number } | { stage: "processing" };

/**
 * Uploads a single file as multipart/form-data, reporting progress.
 *
 * XMLHttpRequest rather than fetch: fetch has no upload progress, and an
 * upload that shows nothing for the seconds a large image takes reads as
 * a frozen page. Once the last byte is sent the server still has work to
 * do — resizing and re-encoding an image — so progress moves to a
 * "processing" phase instead of sitting at 100%.
 *
 * No `Content-Type` header is set on purpose — the browser fills in the
 * multipart boundary itself when given a `FormData` body.
 */
export function apiUpload<T>(path: string, file: File, onPhase?: (phase: UploadPhase) => void): Promise<T> {
  const formData = new FormData();
  formData.append("file", file);

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}${path}`);
    xhr.withCredentials = true;
    xhr.responseType = "text";

    xhr.upload.onprogress = (event) => {
      if (!onPhase) return;
      if (event.lengthComputable) {
        const fraction = event.total > 0 ? event.loaded / event.total : 0;
        onPhase(fraction >= 1 ? { stage: "processing" } : { stage: "sending", fraction });
      }
    };
    xhr.upload.onload = () => onPhase?.({ stage: "processing" });

    xhr.onload = () => {
      let body: { error?: { message?: string; code?: string } } | null = null;
      const isJson = xhr.getResponseHeader("content-type")?.includes("application/json");
      if (isJson) {
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          body = null;
        }
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new ApiError(xhr.status, translateMessage(body?.error?.message ?? "Something went wrong on our end. Please try again."), body?.error?.code));
        return;
      }
      resolve(body as T);
    };
    // A network failure, as fetch reports one: `localizedErrorMessage`
    // turns a TypeError into "couldn't reach the server".
    xhr.onerror = () => reject(new TypeError("Network request failed"));
    xhr.onabort = () => reject(new TypeError("Upload cancelled"));

    onPhase?.({ stage: "sending", fraction: 0 });
    xhr.send(formData);
  });
}
