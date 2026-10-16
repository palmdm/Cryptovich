/** Roughly what Telegram, X and Mastodon show under a link's title. */
const PREVIEW_LENGTH = 200;

/**
 * A post body or bio as one line of plain text, for a link preview's
 * description. The markup `RichText` renders — code fences, headings,
 * quotes, lists, tables, emphasis, `[text](url)` links, `:sticker:` codes —
 * would otherwise show up as literal asterisks and brackets in a chat
 * client, which renders none of it.
 */
export function previewText(markup: string | null | undefined, max = PREVIEW_LENGTH): string | null {
  if (!markup) return null;
  const text = markup
    .replace(/```[^\n]*\n[\s\S]*?(?:```|$)/g, " ")
    .replace(/^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/gm, " ")
    .replace(/^(?:#{1,6}|>|[-*]|\d+\.)\s+/gm, "")
    .replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, "$1")
    .replace(/:[a-z0-9_+-]+:/g, " ")
    .replace(/\*\*|~~|[*`]/g, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ ([.,!?;:…])/g, "$1")
    .trim();
  if (!text) return null;
  if (text.length <= max) return text;

  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
