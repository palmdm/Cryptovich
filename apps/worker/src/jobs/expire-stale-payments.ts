import { prisma } from "@platform/db";

/**
 * Background reconciliation: payments left in a non-terminal state past
 * their expiry are moved to EXPIRED, and any purchase/donation created
 * for them is cancelled. This is the kind of operation that must never
 * run inside a request lifecycle (spec rule #82) — a real chain adapter's
 * confirmation polling would live alongside this same loop.
 */
export async function expireStalePayments(): Promise<number> {
  const stale = await prisma.payment.findMany({
    where: {
      status: { in: ["CREATED", "AWAITING_PAYMENT"] },
      expiresAt: { lt: new Date() },
    },
    select: { id: true },
  });

  for (const { id } of stale) {
    await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUniqueOrThrow({ where: { id } });
      if (payment.status === "CONFIRMED" || payment.status === "REFUNDED") return; // race guard

      await tx.payment.update({ where: { id }, data: { status: "EXPIRED" } });
      await tx.purchase.updateMany({ where: { paymentId: id, status: "PENDING" }, data: { status: "CANCELLED" } });
      await tx.donation.updateMany({ where: { paymentId: id, status: "PENDING" }, data: { status: "CANCELLED" } });
      // A PENDING Subscription tied to this payment must also be cancelled
      // here — otherwise an abandoned subscription checkout leaves the
      // Subscription stuck PENDING forever, and startSubscriptionCheckout's
      // "already have a pending/active subscription" guard permanently
      // blocks the user from ever subscribing to that tier again.
      await tx.subscription.updateMany({ where: { paymentId: id, status: "PENDING" }, data: { status: "CANCELLED" } });
      // A reward riding on the payment was never paid for.
      await tx.rewardGift.updateMany({ where: { paymentId: id, status: "PENDING" }, data: { status: "CANCELLED" } });
    });
  }

  return stale.length;
}
