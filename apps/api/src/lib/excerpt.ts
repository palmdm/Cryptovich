import { stripEmbeds } from "@platform/shared";
const EXCERPT_LENGTH = 400;

/**
 * The preview a feed card shows instead of making the reader open the post
 * to find out what it says.
 *
 * Only ever called for a post the reader may actually read — a gated
 * post's body never reaches a listing at all, the same rule the post
 * endpoint follows (spec rules #63, #133).
 *
 * The author's own `excerpt` wins when they wrote one; otherwise the body
 * is cut at a word boundary. Markup is left as-is: the frontend renders
 * this through `RichText`, exactly like the full body.
 */
export function postExcerpt(post: { excerpt: string | null; content: string } | null | undefined): string | null {
  if (!post) return null;
  if (post.excerpt) return post.excerpt;

  // Files placed in the text show as the card's pictures, not as `![[…]]`.
  const text = stripEmbeds(post.content).trim();
  if (text.length <= EXCERPT_LENGTH) return text || null;

  const cut = text.slice(0, EXCERPT_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > EXCERPT_LENGTH / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Whether opening the post shows more than its card does: the body runs
 * past the excerpt (or the author wrote a separate one), or there are
 * attachments the card does not show. The card offers "expand" only then.
 */
export function postHasMore(
  post: { excerpt: string | null; content: string; _count?: { attachments: number } } | null | undefined,
  /** Attachments the card already shows, which are not "more". */
  shownAttachments = 0,
): boolean {
  if (!post) return false;
  if ((post._count?.attachments ?? 0) - shownAttachments > 0) return true;
  const text = post.content.trim();
  if (post.excerpt) return text.length > 0 && text !== post.excerpt.trim();
  return text.length > EXCERPT_LENGTH;
}
