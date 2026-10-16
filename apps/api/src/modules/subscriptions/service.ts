import type { PrismaClient } from "@platform/db";
import { Errors } from "../../lib/errors.js";
import { requireCreatorProfile } from "../products/product-helpers.js";

export class SubscriptionService {
  constructor(private readonly prisma: PrismaClient) {}

  async listMine(userId: string) {
    return this.prisma.subscription.findMany({
      where: { userId, status: { in: ["ACTIVE", "PAST_DUE"] } },
      include: { tier: { include: { creator: { include: { user: { select: { username: true } } } } } } },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * The author's own subscribers: who is supporting them, on which tier,
   * since when, and whether the subscription is ending.
   *
   * Local subscriptions only. A fediverse follower is not a subscriber —
   * they hold no tier, pay nothing, and live on another server; mixing
   * the two would make the count an author sees mean two different
   * things. Followers from elsewhere are a federation matter and are
   * counted there.
   */
  async listSubscribers(userId: string) {
    const profile = await requireCreatorProfile(this.prisma, userId);

    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        tier: { creatorId: profile.id },
        status: { in: ["ACTIVE", "PAST_DUE"] },
      },
      include: {
        user: { select: { username: true, creatorProfile: { select: { displayName: true, avatarUrl: true, avatarFrame: true } } } },
        tier: { select: { id: true, name: true, amountMinor: true, currency: true, period: true } },
      },
      orderBy: { startedAt: "desc" },
    });

    return subscriptions.map((subscription) => ({
      id: subscription.id,
      username: subscription.user.username,
      displayName: subscription.user.creatorProfile?.displayName ?? subscription.user.username,
      avatarUrl: subscription.user.creatorProfile?.avatarUrl ?? null,
      avatarFrame: subscription.user.creatorProfile?.avatarFrame ?? null,
      tier: {
        id: subscription.tier.id,
        name: subscription.tier.name,
        amountMinor: subscription.tier.amountMinor.toString(),
        currency: subscription.tier.currency,
        period: subscription.tier.period,
      },
      status: subscription.status,
      startedAt: subscription.startedAt,
      expiresAt: subscription.expiresAt,
      // Cancelled but still inside the period they paid for: they are a
      // subscriber today and will not be one after `expiresAt`.
      endingAt: subscription.cancelledAt ? subscription.expiresAt : null,
    }));
  }

  /**
   * Cancels at period end (spec-typical creator-platform UX): access
   * continues through `expiresAt`; the background expiry job (spec rule
   * #82) will flip status to CANCELLED instead of EXPIRED once it lapses.
   */
  async cancel(userId: string, subscriptionId: string) {
    const subscription = await this.prisma.subscription.findUnique({ where: { id: subscriptionId } });
    if (!subscription || subscription.userId !== userId) throw Errors.notFound("Subscription");
    if (subscription.status !== "ACTIVE") throw Errors.validation("This subscription is not active.");

    return this.prisma.subscription.update({ where: { id: subscriptionId }, data: { cancelledAt: new Date() } });
  }
}
