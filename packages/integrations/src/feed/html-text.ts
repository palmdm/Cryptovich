function codePoint(code: number): string | null {
  // `&#38;` is an ampersand like `&amp;`, and is left for the last step so
  // that `&#38;lt;` does not turn into a `<`.
  if (code === 38 || !Number.isFinite(code) || code <= 0 || code > 0x10ffff) return null;
  return String.fromCodePoint(code);
}

/**
 * `&amp;` is decoded last, so `&amp;lt;` becomes the literal text `&lt;`
 * rather than being decoded twice into a `<`.
 */
function decodeEntities(value: string): string {
  return value
    // Numeric references — `&#8212;`, `&#x27;` — which Misskey, Sharkey and
    // many blogs emit, and which used to arrive as those literal characters.
    .replace(/&#(\d+);/g, (whole, code: string) => codePoint(Number(code)) ?? whole)
    .replace(/&#x([0-9a-f]+);/gi, (whole, code: string) => codePoint(parseInt(code, 16)) ?? whole)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#0*38;|&#x0*26;/gi, "&")
    .replace(/&amp;/g, "&");
}

/**
 * Reduces a fragment of feed HTML to plain text. Feed content is
 * untrusted and is stored as the body of a post, so every tag is dropped
 * rather than sanitised — the platform renders post bodies as text, and
 * nothing in a syndicated summary needs markup to survive.
 *
 * Entities are decoded *before* tags are stripped, because an RSS
 * `<description>` carries its HTML escaped: `&lt;p&gt;Hi&lt;/p&gt;` is a
 * paragraph, not the literal characters. Stripping first would leave
 * "<p>Hi</p>" sitting in the post body as visible text.
 */
export function stripHtml(html: string): string {
  return decodeEntities(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
