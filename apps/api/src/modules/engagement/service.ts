import type { PrismaClient } from "@platform/db";
import { Errors } from "../../lib/errors.js";

/** As many as one listing can hold; anything beyond is a script. */
const MAX_IMPRESSIONS_PER_CALL = 200;

export interface EngagementStats {
  impressions: number;
  opens: number;
  reactions: number;
  comments: number;
  bookmarks: number;
  /** The headline figure in the breakdown — every counted interaction, summed. */
  total: number;
}

export class EngagementService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Counts a post being *shown* in a listing, as distinct from opened.
   * Mirrors viewCount's rule — an author scrolling past their own post
   * never inflates their own numbers — and stays silent for a product
   * that no longer exists rather than 404ing a fire-and-forget beacon.
   */
  /**
   * Impressions for a whole listing in one call.
   *
   * A page shows as many cards as the author has posts, and one request
   * per card meant a profile with 700 of them fired 700 of them at once:
   * the reader burned the API's whole rate-limit budget on its own page
   * and every request they made for the next minute was refused. Two
   * queries now, whatever the page's length.
   */
  async recordImpressions(productIds: string[], userId: string | null): Promise<number> {
    const ids = [...new Set(productIds)].slice(0, MAX_IMPRESSIONS_PER_CALL);
    if (ids.length === 0) return 0;

    const countable = await this.prisma.digitalProduct.findMany({
      where: {
        id: { in: ids },
        status: "PUBLISHED",
        deletedAt: null,
        // An author's own page is not an audience.
        ...(userId ? { creator: { userId: { not: userId } } } : {}),
      },
      select: { id: true },
    });
    if (countable.length === 0) return 0;

    const { count } = await this.prisma.digitalProduct.updateMany({
      where: { id: { in: countable.map((p) => p.id) } },
      data: { impressionCount: { increment: 1 } },
    });
    return count;
  }

  async recordImpression(productId: string, userId: string | null): Promise<void> {
    const product = await this.prisma.digitalProduct.findUnique({
      where: { id: productId },
      select: { deletedAt: true, status: true, creator: { select: { userId: true } } },
    });
    if (!product || product.deletedAt || product.status !== "PUBLISHED") return;
    if (userId && product.creator.userId === userId) return;

    await this.prisma.digitalProduct.update({
      where: { id: productId },
      data: { impressionCount: { increment: 1 } },
    });
  }

  async toggleBookmark(userId: string, productId: string): Promise<{ bookmarked: boolean }> {
    const product = await this.prisma.digitalProduct.findUnique({
      where: { id: productId },
      select: { deletedAt: true },
    });
    if (!product || product.deletedAt) throw Errors.notFound("Product");

    const existing = await this.prisma.bookmark.findUnique({
      where: { userId_productId: { userId, productId } },
    });
    if (existing) {
      await this.prisma.bookmark.delete({ where: { id: existing.id } });
      return { bookmarked: false };
    }
    await this.prisma.bookmark.create({ data: { userId, productId } });
    return { bookmarked: true };
  }

  async isBookmarked(userId: string | null, productId: string): Promise<boolean> {
    if (!userId) return false;
    const row = await this.prisma.bookmark.findUnique({
      where: { userId_productId: { userId, productId } },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * Which of these posts the reader has bookmarked, in one query — the
   * batched twin of `isBookmarked`, so a listing can put a filled icon on
   * each card without a request per card.
   */
  async bookmarkedAmong(userId: string | null, productIds: string[]): Promise<Set<string>> {
    if (!userId || productIds.length === 0) return new Set();
    const rows = await this.prisma.bookmark.findMany({
      where: { userId, productId: { in: productIds } },
      select: { productId: true },
    });
    return new Set(rows.map((r) => r.productId));
  }

  /**
   * The breakdown behind the engagement figure. Author-only: these are
   * the post's performance numbers, not public metadata — the public
   * store response carries view and comment counts and nothing more.
   */
  async statsForOwner(userId: string, productId: string): Promise<EngagementStats> {
    const product = await this.prisma.digitalProduct.findUnique({
      where: { id: productId },
      select: {
        deletedAt: true,
        viewCount: true,
        impressionCount: true,
        creator: { select: { userId: true } },
        _count: {
          select: {
            reactions: true,
            bookmarks: true,
            comments: { where: { deletedAt: null } },
          },
        },
      },
    });
    if (!product || product.deletedAt) throw Errors.notFound("Product");
    if (product.creator.userId !== userId) throw Errors.forbidden();

    const stats = {
      impressions: product.impressionCount,
      opens: product.viewCount,
      reactions: product._count.reactions,
      comments: product._count.comments,
      bookmarks: product._count.bookmarks,
    };
    return { ...stats, total: Object.values(stats).reduce((sum, n) => sum + n, 0) };
  }
}
