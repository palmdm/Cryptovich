import { ShortLinkService } from "../short-links/service.js";
import type { Prisma, PrismaClient } from "@platform/db";
import { ReactionService } from "../reactions/service.js";
import { EntitlementService } from "../entitlements/service.js";
import { EngagementService } from "../engagement/service.js";
import { cardBody, cardPostSelect } from "../../lib/post-card.js";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;

/** What a card needs of a post, whoever's listing it appears in. */
const CARD_INCLUDE = {
  prices: { where: { active: true } },
  // Sent only for a post this reader may read — see `cards`.
  post: { select: cardPostSelect },
  requiredTier: { select: { id: true, name: true } },
  requiredGoal: { select: { id: true, title: true } },
  creator: {
    select: { displayName: true, avatarUrl: true, avatarFrame: true, user: { select: { id: true, username: true } } },
  },
  _count: { select: { comments: { where: { deletedAt: null } }, reactions: true } },
  categories: { include: { category: { select: { id: true, name: true, slug: true } } } },
  tags: { include: { tag: { select: { id: true, name: true } } } },
} as const;

/**
 * The reader's home timeline: everything published by the authors they
 * subscribe to, newest first.
 *
 * "Subscribed" means any active subscription, including a free follow —
 * those are ordinary Subscription rows on a zero-priced tier, so no
 * special case is needed and following someone for free is enough to see
 * them here.
 *
 * Gated posts are listed rather than hidden. That is the platform's
 * standing rule (a paid post keeps its title, price and place in every
 * listing; only its body is withheld), and it is what makes the feed
 * useful to a subscriber deciding what to unlock. The body is never
 * attached here — reading one goes through the post endpoint, which asks
 * EntitlementService.
 */
export class FeedService {
  private readonly reactions: ReactionService;
  private readonly entitlements: EntitlementService;
  private readonly engagement: EngagementService;

  constructor(private readonly prisma: PrismaClient) {
    this.reactions = new ReactionService(prisma);
    this.entitlements = new EntitlementService(prisma);
    this.engagement = new EngagementService(prisma);
  }

  async forUser(userId: string, options: { limit?: number; cursor?: string } = {}) {
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

    const [subscriptions, own, follows] = await Promise.all([
      this.prisma.subscription.findMany({
        where: { userId, status: "ACTIVE", expiresAt: { gt: new Date() } },
        select: { tier: { select: { creatorId: true } } },
      }),
      this.prisma.creatorProfile.findUnique({ where: { userId }, select: { id: true } }),
      this.prisma.follow.findMany({ where: { userId }, select: { creatorId: true } }),
    ]);
    // One author can be subscribed to on several tiers at once; their
    // posts must still appear once. The reader's own posts are in it too:
    // the feed is where a post is written (its composer), and one written
    // there has to show up there.
    const creatorIds = [
      ...new Set([...subscriptions.map((s) => s.tier.creatorId), ...follows.map((f) => f.creatorId), ...(own ? [own.id] : [])]),
    ];
    if (creatorIds.length === 0) return { items: [], nextCursor: null };

    const rows = await this.prisma.digitalProduct.findMany({
      where: {
        creatorId: { in: creatorIds },
        status: "PUBLISHED",
        deletedAt: null,
        // A published product always has this set; the guard keeps a row
        // with a null date from sorting unpredictably at the boundary.
        publishedAt: { not: null },
      },
      include: CARD_INCLUDE,
      // `id` breaks ties so the cursor can never skip or repeat a post
      // that shares a timestamp with its neighbour.
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    });

    // One extra row was fetched purely to answer "is there more?".
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return { items: await this.cards(userId, page), nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null };
  }

  /**
   * The posts a reader has bookmarked, most recently saved first.
   *
   * A bookmark outlives what it points at, so a post that has since been
   * unpublished, deleted or taken down is simply not listed; one the
   * reader can no longer open (a lapsed subscription) still is, locked —
   * the same rule every other listing follows, decided by the same
   * entitlement check.
   */
  async bookmarks(userId: string, options: { limit?: number; cursor?: string } = {}) {
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

    const marks = await this.prisma.bookmark.findMany({
      where: {
        userId,
        product: {
          status: "PUBLISHED",
          deletedAt: null,
          publishedAt: { not: null },
          creator: { user: { deletedAt: null, suspendedAt: null } },
        },
      },
      include: { product: { include: CARD_INCLUDE } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    });

    const hasMore = marks.length > limit;
    const page = hasMore ? marks.slice(0, limit) : marks;
    return {
      items: await this.cards(
        userId,
        page.map((m) => m.product),
      ),
      // A bookmark's id, not the post's: the list is ordered by when it was
      // saved, and that is what the cursor has to walk.
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  private async cards(userId: string, page: Array<Prisma.DigitalProductGetPayload<{ include: typeof CARD_INCLUDE }>>) {
    const reactionSummaries = await this.reactions.summariesFor(
      page.map((p) => p.id),
      { userId, readerKey: null },
    );
    const bookmarked = await this.engagement.bookmarkedAmong(
      userId,
      page.map((p) => p.id),
    );

    // Subscribing is what puts an author here, so most of these posts are
    // readable: the card shows their opening lines, and only the ones this
    // reader really cannot open keep the lock.
    const allowed = await this.entitlements.allowedProductIds(
      userId,
      page.map((p) => ({
        id: p.id,
        creatorId: p.creatorId,
        creatorUserId: p.creator.user.id,
        status: p.status,
        visibility: p.visibility,
        requiredTierId: p.requiredTierId,
        requiredGoalId: p.requiredGoalId,
      })),
    );

    const cards = page.map((p) => ({
      id: p.id,
      type: p.type,
      title: p.title,
      slug: p.slug,
      description: p.description,
      coverUrl: p.coverUrl,
      visibility: p.visibility,
      requiredTier: p.requiredTier,
      requiredGoal: p.requiredGoal,
      discountPercent: p.discountPercent,
      discountEndsAt: p.discountEndsAt,
      canAccess: allowed.has(p.id),
      // The excerpt and the pictures reach a reader only when the
      // entitlement check cleared them — a locked card offers the unlock,
      // not a preview of what is behind it.
      ...cardBody(p.id, p.post, allowed.has(p.id)),
      bookmarked: bookmarked.has(p.id),
      prices: p.prices,
      publishedAt: p.publishedAt,
      // The eye under a post counts everyone who saw it: shown in a listing
      // or opened. The two apart are in its statistics (engagement).
      viewCount: p.viewCount + p.impressionCount,
      commentCount: p._count.comments,
      reactionCount: p._count.reactions,
      reactions: reactionSummaries[p.id] ?? { counts: [], mine: [] },
      categories: p.categories.map((c) => c.category),
      tags: p.tags.map((t) => t.tag),
      // These lists span authors, so each card has to name its own.
      creator: {
        username: p.creator.user.username,
        displayName: p.creator.displayName,
        avatarUrl: p.creator.avatarUrl,
        avatarFrame: p.creator.avatarFrame,
      },
    }));
    // In each card's opening lines, @[text](url) is this reader's own short link.
    const excerpts = await new ShortLinkService(this.prisma).personalize(
      page.map((p, n) => ({ productId: p.id, ownerId: p.creator.user.id, text: cards[n]!.excerpt ?? null })),
      userId,
    );
    return cards.map((card, n) => ({ ...card, excerpt: excerpts[n] ?? null }));
  }
}
