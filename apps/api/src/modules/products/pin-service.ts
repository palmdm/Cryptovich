import type { PrismaClient } from "@platform/db";
import { AppError, Errors } from "../../lib/errors.js";
import { withScopeLock } from "../../lib/scope-lock.js";
import { requireCreatorProfile, requireOwnedProduct } from "./product-helpers.js";

/** How many posts an author may pin. */
export const PIN_LIMIT = 2;
/** …and how many once they have supported the server. */
export const SUPPORTER_PIN_LIMIT = 5;

/**
 * Pinned posts: the ones an author keeps at the top of their profile,
 * above everything newer — and the ones the fediverse sees as pinned,
 * since the ActivityPub `featured` collection is exactly this list.
 *
 * Two per author; five for an author who has supported the server — a
 * confirmed donation to an administrator, or an approved API-access
 * contribution, which is sent to the administrator too. Stored on the
 * post as `featured` / `featuredPosition`, which the profile listing
 * already sorted by.
 */
export class PinService {
  constructor(
    private readonly prisma: PrismaClient,
    /** Told after a change, so followers' servers re-read the pins. */
    private readonly onChange?: (creatorId: string) => Promise<unknown>,
  ) {}

  async limitFor(userId: string): Promise<number> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    // The operator does not donate to themselves.
    if (user?.role === "ADMIN") return SUPPORTER_PIN_LIMIT;
    const [donated, contributed] = await Promise.all([
      this.prisma.donation.count({
        where: { senderUserId: userId, status: "COMPLETED", creator: { user: { role: "ADMIN" } } },
      }),
      this.prisma.apiAccessRequest.count({ where: { userId, status: "APPROVED" } }),
    ]);
    return donated + contributed > 0 ? SUPPORTER_PIN_LIMIT : PIN_LIMIT;
  }

  /** The author's pins, in order, and how many they may have. */
  async state(userId: string) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const [pinned, limit] = await Promise.all([
      this.prisma.digitalProduct.findMany({
        where: { creatorId: profile.id, featured: true, deletedAt: null, status: "PUBLISHED" },
        orderBy: [{ featuredPosition: { sort: "asc", nulls: "last" } }, { publishedAt: "desc" }],
        select: { id: true },
      }),
      this.limitFor(userId),
    ]);
    return { limit, pinned: pinned.map((p) => p.id) };
  }

  async pin(userId: string, productId: string) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const product = await requireOwnedProduct(this.prisma, profile.id, productId);
    if (product.status !== "PUBLISHED") throw Errors.validation("Only a published post can be pinned.");

    if (!product.featured) {
      const limit = await this.limitFor(userId);
      // Count, then pin: two requests together must not both see room
      // for one more.
      await withScopeLock(this.prisma, `pins:${profile.id}`, async (tx) => {
        const pinned = await tx.digitalProduct.findMany({
          where: { creatorId: profile.id, featured: true, deletedAt: null, status: "PUBLISHED" },
          select: { featuredPosition: true },
        });
        if (pinned.length >= limit) {
          throw new AppError(
            409,
            limit < SUPPORTER_PIN_LIMIT
              ? `You can pin ${limit} posts. Support the server with a donation to its administrator to pin up to ${SUPPORTER_PIN_LIMIT}.`
              : `You can pin up to ${limit} posts. Unpin one first.`,
            limit < SUPPORTER_PIN_LIMIT ? "PIN_LIMIT" : "PIN_LIMIT_MAX",
          );
        }
        // Newly pinned goes below the ones already there.
        const next = pinned.reduce((max, p) => Math.max(max, p.featuredPosition ?? -1), -1) + 1;
        await tx.digitalProduct.update({ where: { id: productId }, data: { featured: true, featuredPosition: next } });
      });
      await this.changed(profile.id);
    }
    return this.state(userId);
  }

  async unpin(userId: string, productId: string) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const product = await requireOwnedProduct(this.prisma, profile.id, productId);
    if (product.featured) {
      await this.prisma.digitalProduct.update({ where: { id: productId }, data: { featured: false, featuredPosition: null } });
      await this.changed(profile.id);
    }
    return this.state(userId);
  }

  private async changed(creatorId: string) {
    try {
      await this.onChange?.(creatorId);
    } catch {
      // Telling the fediverse is best-effort; the pin itself stands.
    }
  }
}
