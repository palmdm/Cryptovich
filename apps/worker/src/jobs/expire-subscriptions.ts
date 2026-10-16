import { prisma } from "@platform/db";

/**
 * Crypto subscriptions are prepaid periods, not auto-renewing charges —
 * there is no custodial mandate to pull a second payment automatically.
 * When a period lapses: if the subscriber cancelled, it settles as
 * CANCELLED; otherwise EXPIRED, and EntitlementService.canAccessProduct
 * (which checks Subscription live) stops granting access the moment this
 * runs, without needing to touch any Entitlement rows.
 */
export async function expireLapsedSubscriptions(): Promise<number> {
  const lapsed = await prisma.subscription.findMany({
    where: { status: "ACTIVE", expiresAt: { lt: new Date() } },
    select: {
      id: true,
      cancelledAt: true,
      userId: true,
      tier: { select: { name: true, creator: { select: { displayName: true, user: { select: { username: true } } } } } },
    },
  });

  for (const sub of lapsed) {
    // The status change and the notification commit together: a lapse
    // the subscriber never hears about is how access quietly disappears.
    await prisma.$transaction([
      prisma.subscription.update({
        where: { id: sub.id },
        data: { status: sub.cancelledAt ? "CANCELLED" : "EXPIRED" },
      }),
      prisma.notification.create({
        data: {
          userId: sub.userId,
          type: "SUBSCRIPTION_EXPIRED",
          payload: {
            tierName: sub.tier.name,
            creatorUsername: sub.tier.creator.user.username,
            creatorName: sub.tier.creator.displayName,
            cancelled: Boolean(sub.cancelledAt),
          },
        },
      }),
    ]);
  }

  return lapsed.length;
}

/**
 * Warns a subscriber before the period actually runs out, so renewing is
 * a decision rather than a discovery. Prepaid periods do not auto-renew,
 * which is exactly why this warning has to exist.
 *
 * `expiryWarningSentAt` is what stops it firing on every tick — without
 * it a subscription in its final days would notify every 30 seconds.
 */
export async function warnExpiringSubscriptions(withinMs = 3 * 24 * 60 * 60 * 1000): Promise<number> {
  const now = new Date();
  const soon = new Date(now.getTime() + withinMs);

  const expiring = await prisma.subscription.findMany({
    where: {
      status: "ACTIVE",
      cancelledAt: null,
      expiresAt: { gt: now, lt: soon },
      expiryWarningSentAt: null,
    },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      tier: { select: { name: true, creator: { select: { displayName: true, user: { select: { username: true } } } } } },
    },
  });

  for (const sub of expiring) {
    await prisma.$transaction([
      prisma.subscription.update({ where: { id: sub.id }, data: { expiryWarningSentAt: now } }),
      prisma.notification.create({
        data: {
          userId: sub.userId,
          type: "SUBSCRIPTION_EXPIRING",
          payload: {
            tierName: sub.tier.name,
            creatorUsername: sub.tier.creator.user.username,
            creatorName: sub.tier.creator.displayName,
            expiresAt: sub.expiresAt.toISOString(),
          },
        },
      }),
    ]);
  }

  return expiring.length;
}
