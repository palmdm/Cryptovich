/**
 * URL handling for values supplied by users and rendered back to other
 * users.
 *
 * `z.string().url()` only checks that the string parses as a URL, and
 * `new URL("javascript:alert(1)")` parses perfectly well — so does
 * `data:text/html,<script>…</script>` and `vbscript:`. A value that
 * reaches an `href` is then a stored cross-site scripting vector: the
 * script runs in the origin of whoever clicks it, with their session.
 *
 * Only http and https are ever appropriate for a link or an image this
 * platform shows on someone else's behalf, so that is the whole
 * allowlist. Everything else — including schemes not invented yet — is
 * rejected by default rather than enumerated.
 */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export function isSafeHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return ALLOWED_PROTOCOLS.has(parsed.protocol);
}

/**
 * For render sites: returns the URL when it is safe to put in an `href`
 * or `src`, and null when it is not. Callers render nothing rather than
 * falling back to the raw value — a fallback would defeat the check.
 *
 * Relative paths are passed through: they cannot carry a scheme, and the
 * app builds its own from server-controlled routes.
 */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  return isSafeHttpUrl(value) ? value : null;
}
