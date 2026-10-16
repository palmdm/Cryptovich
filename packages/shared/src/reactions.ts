/**
 * What a reaction may be: any one emoji — a single picture, however many
 * code points make it (a family, a flag, a skin tone) — or a server
 * sticker by its `:shortcode:`. The column is a plain string, so this is
 * what keeps arbitrary text out; a shortcode is also checked against the
 * server's stickers where the reaction is stored.
 *
 * Reactions are never gated by EntitlementService the way post content or
 * comments are: picking one costs nothing and reveals nothing, so it's
 * available on a locked/paid post exactly as its title already is.
 */

/** Offered first, before any search: Misskey's default row. */
export const QUICK_REACTIONS = ["👍", "❤️", "😆", "🤔", "😮", "🎉", "💢", "😥", "😇", "🍮"] as const;

/** @deprecated The fixed set reactions used to be limited to; now only the quick row. */
export const REACTION_EMOJIS = QUICK_REACTIONS;

const SHORTCODE_REACTION = /^:[a-z0-9_+-]{1,40}:$/;

export function isShortcodeReaction(value: string): boolean {
  return SHORTCODE_REACTION.test(value);
}

/** One emoji picture. */
export function isUnicodeEmoji(value: string): boolean {
  if (value.length === 0 || value.length > 32 || /\s/.test(value)) return false;
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const graphemes = [...segmenter.segment(value)];
  if (graphemes.length !== 1) return false;
  // A keycap (1️⃣) is a digit with a combining mark; the rest carry a
  // pictographic code point or a pair of regional indicators (a flag).
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(value);
}

export function isReactionEmoji(value: string): boolean {
  return isUnicodeEmoji(value) || isShortcodeReaction(value);
}

/** The shortcode inside `:name:`, or null for a Unicode emoji. */
export function reactionShortcode(value: string): string | null {
  return isShortcodeReaction(value) ? value.slice(1, -1) : null;
}
