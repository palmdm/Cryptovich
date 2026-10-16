/**
 * The single definition of a usable custom-emoji shortcode, shared by the
 * API's validation, the sticker-import worker, and the renderer that
 * substitutes `:shortcode:` in post and comment text.
 *
 * Keeping one definition matters because the failure is silent: a
 * shortcode stored outside this grammar is saved successfully and then
 * never matches the renderer, so the emoji simply never appears.
 */
export const SHORTCODE_PATTERN = /^[a-z0-9_+-]+$/;
export const SHORTCODE_MAX_LENGTH = 40;

/**
 * Folds an external provider's emoji name into a usable shortcode, or
 * returns null when it cannot be represented — a remote emoji named
 * "Wave 2" becomes "wave_2", one named "🎉" becomes null rather than an
 * empty string.
 */
export function toShortcode(rawName: string): string | null {
  const candidate = rawName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_+-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!candidate || candidate.length > SHORTCODE_MAX_LENGTH) return null;
  return SHORTCODE_PATTERN.test(candidate) ? candidate : null;
}
