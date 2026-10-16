import type { Prisma, PrismaClient } from "@platform/db";
import { Errors } from "../../lib/errors.js";
import { reactionShortcode } from "@platform/shared";
import type { ReactionViewer } from "../../lib/reader-key.js";
import { assertMayReactWith } from "../rewards/service.js";

export interface ReactionCount {
  emoji: string;
  count: number;
}

export interface ReactionSummary {
  counts: ReactionCount[];
  /** Which reactions the caller has picked — an account's, or a signed-out reader's by their cookie. */
  mine: string[];
}

/** One person who reacted, for the "who reacted" list. */
export interface ReactionPerson {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  avatarFrame: string | null;
  /** Their reactions on this post, the most recent first. */
  emojis: string[];
  postCount: number;
  /** Null when the author keeps their subscriber count private. */
  subscriberCount: number | null;
}

const PEOPLE_PAGE = 40;

/** Which rows are the viewer's own; null when there is no viewer at all. */
function mineWhere(viewer: ReactionViewer): Prisma.ReactionWhereInput | null {
  if (viewer.userId) return { userId: viewer.userId };
  if (viewer.readerKey) return { readerKey: viewer.readerKey };
  return null;
}

/**
 * Unlike comments (gated by the same rule as post content), a reaction
 * is never checked against EntitlementService — picking an emoji costs
 * nothing and reveals nothing about a locked post, so it stays available
 * on paid/private products exactly as their title and price already are.
 */
export class ReactionService {
  constructor(private readonly prisma: PrismaClient) {}

  private async requireProduct(productId: string) {
    const product = await this.prisma.digitalProduct.findUnique({
      where: { id: productId },
      select: { id: true, deletedAt: true },
    });
    if (!product || product.deletedAt) throw Errors.notFound("Product");
  }

  async summary(productId: string, viewer: ReactionViewer): Promise<ReactionSummary> {
    const grouped = await this.prisma.reaction.groupBy({
      by: ["emoji"],
      where: { productId },
      _count: { emoji: true },
    });
    const counts = grouped
      .map((g) => ({ emoji: g.emoji, count: g._count.emoji }))
      .sort((a, b) => b.count - a.count);

    const own = mineWhere(viewer);
    const mine = own
      ? (
          await this.prisma.reaction.findMany({
            where: { productId, ...own },
            select: { emoji: true },
          })
        ).map((r) => r.emoji)
      : [];

    return { counts, mine };
  }

  /**
   * The same summaries for a whole listing, in two queries rather than
   * two per post — a feed of thirty cards would otherwise be sixty
   * round-trips just to render the reaction rows.
   */
  async summariesFor(productIds: string[], viewer: ReactionViewer): Promise<Record<string, ReactionSummary>> {
    const summaries: Record<string, ReactionSummary> = Object.fromEntries(
      productIds.map((id) => [id, { counts: [], mine: [] }]),
    );
    if (productIds.length === 0) return summaries;

    const grouped = await this.prisma.reaction.groupBy({
      by: ["productId", "emoji"],
      where: { productId: { in: productIds } },
      _count: { emoji: true },
    });
    for (const row of grouped) {
      summaries[row.productId]?.counts.push({ emoji: row.emoji, count: row._count.emoji });
    }
    for (const summary of Object.values(summaries)) {
      summary.counts.sort((a, b) => b.count - a.count);
    }

    const own = mineWhere(viewer);
    if (own) {
      const mine = await this.prisma.reaction.findMany({
        where: { productId: { in: productIds }, ...own },
        select: { productId: true, emoji: true },
      });
      for (const row of mine) {
        summaries[row.productId]?.mine.push(row.emoji);
      }
    }

    return summaries;
  }

  /**
   * Adds the caller's reaction if absent, removes it if present — one
   * click, one state flip, idempotent under a double click via the
   * compound unique keys. The caller is an account or, signed out, the
   * reader key their browser was given.
   */
  async toggle(viewer: ReactionViewer, productId: string, emoji: string): Promise<ReactionSummary> {
    const own = mineWhere(viewer);
    if (!own) throw Errors.unauthorized();
    await this.requireProduct(productId);

    const existing = await this.prisma.reaction.findFirst({ where: { productId, emoji, ...own } });
    if (existing) {
      await this.prisma.reaction.delete({ where: { id: existing.id } });
    } else {
      // A sticker reaction must name one of the server's stickers — the
      // shape alone (`:word:`) would let anyone store any word — and a
      // reward sticker one this reader, as an author, was given.
      const shortcode = reactionShortcode(emoji);
      if (shortcode) await assertMayReactWith(this.prisma, shortcode, viewer.userId);
      // Many different reactions from one reader on one post are a script,
      // not a reader.
      if ((await this.prisma.reaction.count({ where: { productId, ...own } })) >= 20) {
        throw Errors.validation("That is enough reactions on one post.");
      }
      try {
        await this.prisma.reaction.create({
          data: { productId, emoji, userId: viewer.userId, readerKey: viewer.userId ? null : viewer.readerKey },
        });
      } catch (err) {
        // Two clicks raced past the check above; the first one counted.
        if ((err as { code?: string }).code !== "P2002") throw err;
      }
    }

    return this.summary(productId, viewer);
  }

  /**
   * The accounts that reacted to a post, most recent first, one row per
   * person with all their reactions on it; `emoji` narrows it to one.
   * Readers who reacted without an account are counted, never listed —
   * there is nobody to show.
   */
  async people(productId: string, options: { emoji?: string; offset?: number } = {}) {
    await this.requireProduct(productId);
    const filter = { productId, ...(options.emoji ? { emoji: options.emoji } : {}) };
    const offset = Math.max(0, Math.floor(options.offset ?? 0));

    const [rows, anonymous] = await Promise.all([
      // Newest reaction first; the person is placed by their latest one.
      this.prisma.reaction.findMany({
        where: { ...filter, userId: { not: null }, user: { deletedAt: null, suspendedAt: null } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { userId: true, emoji: true },
      }),
      this.prisma.reaction.count({ where: { ...filter, userId: null } }),
    ]);

    const order: string[] = [];
    const emojis = new Map<string, string[]>();
    for (const row of rows) {
      const id = row.userId!;
      if (!emojis.has(id)) {
        emojis.set(id, []);
        order.push(id);
      }
      emojis.get(id)!.push(row.emoji);
    }
    const pageIds = order.slice(offset, offset + PEOPLE_PAGE);

    const users = await this.prisma.user.findMany({
      where: { id: { in: pageIds } },
      select: {
        id: true,
        username: true,
        creatorProfile: { select: { id: true, displayName: true, avatarUrl: true, avatarFrame: true, showSubscriberCount: true } },
      },
    });
    const profileIds = users.flatMap((u) => (u.creatorProfile ? [u.creatorProfile.id] : []));
    const [posts, subscriptions] = await Promise.all([
      this.prisma.digitalProduct.groupBy({
        by: ["creatorId"],
        where: { creatorId: { in: profileIds }, status: "PUBLISHED", deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.subscription.findMany({
        // Counted the way the author's own page counts them.
        where: { status: "ACTIVE", tier: { creatorId: { in: profileIds } } },
        select: { tier: { select: { creatorId: true } } },
      }),
    ]);
    const postCount = new Map(posts.map((p) => [p.creatorId, p._count._all]));
    const subscriberCount = new Map<string, number>();
    for (const s of subscriptions) subscriberCount.set(s.tier.creatorId, (subscriberCount.get(s.tier.creatorId) ?? 0) + 1);

    const byId = new Map(users.map((u) => [u.id, u]));
    const people: ReactionPerson[] = pageIds.flatMap((id) => {
      const u = byId.get(id);
      if (!u) return [];
      const profile = u.creatorProfile;
      return [
        {
          username: u.username,
          displayName: profile?.displayName ?? u.username,
          avatarUrl: profile?.avatarUrl ?? null,
          avatarFrame: profile?.avatarFrame ?? null,
          emojis: emojis.get(id) ?? [],
          postCount: profile ? postCount.get(profile.id) ?? 0 : 0,
          subscriberCount: profile?.showSubscriberCount ? subscriberCount.get(profile.id) ?? 0 : null,
        },
      ];
    });

    return {
      people,
      total: order.length,
      anonymous,
      nextOffset: offset + PEOPLE_PAGE < order.length ? offset + PEOPLE_PAGE : null,
    };
  }
}
