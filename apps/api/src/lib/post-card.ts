import { postExcerpt, postHasMore } from "./excerpt.js";

/** Pictures a card shows without the post being opened. */
export const CARD_IMAGE_LIMIT = 3;

/**
 * What a listing loads of a post to draw its card: the body (for the
 * excerpt) and the attachments' metadata (for the pictures). Never a
 * storage key — a picture is reached only through the gated download
 * route, which asks EntitlementService on every request.
 */
export const cardPostSelect = {
  excerpt: true,
  content: true,
  attachments: {
    orderBy: { position: "asc" },
    select: { id: true, kind: true, altText: true, originalFilename: true },
  },
} as const;

interface CardPost {
  excerpt: string | null;
  content: string;
  attachments: { id: string; kind: string; altText: string | null; originalFilename: string }[];
}

export interface CardImage {
  id: string;
  url: string;
  alt: string;
}

/**
 * The parts of a card that come out of the post itself. All of them are
 * withheld for a reader the entitlement check did not clear: a locked card
 * offers the unlock, not a preview of what is behind it.
 */
export function cardBody(productId: string, post: CardPost | null | undefined, canAccess: boolean) {
  if (!canAccess || !post) return { excerpt: null, hasMore: false, images: [] as CardImage[], imageCount: 0 };

  const all = post.attachments.filter((a) => a.kind === "IMAGE");
  const images = all.slice(0, CARD_IMAGE_LIMIT).map((a) => ({
    id: a.id,
    url: `/products/${productId}/attachments/${a.id}/file`,
    alt: a.altText ?? a.originalFilename,
  }));
  return {
    excerpt: postExcerpt(post),
    // "Open the post" is offered only when it shows more than the card:
    // pictures the card already carries do not count.
    hasMore: postHasMore({ ...post, _count: { attachments: post.attachments.length } }, images.length),
    images,
    imageCount: all.length,
  };
}
