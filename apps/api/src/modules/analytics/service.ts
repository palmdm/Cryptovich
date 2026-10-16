import type { PrismaClient } from "@platform/db";
import { requireCreatorProfile } from "../products/product-helpers.js";

export type AnalyticsPeriod = "7d" | "30d" | "90d" | "1y" | "all";

function periodToCutoff(period: AnalyticsPeriod): Date | null {
  const days: Record<Exclude<AnalyticsPeriod, "all">, number> = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 };
  if (period === "all") return null;
  return new Date(Date.now() - days[period] * 24 * 60 * 60 * 1000);
}

/** Sums per currency — amounts in different currencies are never blended into one number (spec rule #56). */
function sumByCurrency(rows: Array<{ amountMinor: bigint; currency: string }>): Record<string, string> {
  const totals = new Map<string, bigint>();
  for (const row of rows) totals.set(row.currency, (totals.get(row.currency) ?? 0n) + row.amountMinor);
  return Object.fromEntries([...totals.entries()].map(([currency, amount]) => [currency, amount.toString()]));
}

function addTotals(a: Record<string, string>, b: Record<string, string>): Record<string, string> {
  const merged = new Map<string, bigint>();
  for (const [currency, amount] of Object.entries(a)) merged.set(currency, BigInt(amount));
  for (const [currency, amount] of Object.entries(b)) merged.set(currency, (merged.get(currency) ?? 0n) + BigInt(amount));
  return Object.fromEntries([...merged.entries()].map(([currency, amount]) => [currency, amount.toString()]));
}

/**
 * Every figure here is a real aggregate over Purchase/Donation/Subscription
 * and RewardGift rows — nothing is estimated or fabricated (spec rule #146: no fake
 * revenue/subscriber numbers in the UI). Where a real figure genuinely
 * isn't tracked yet (fees, per-period views), it's simply omitted rather
 * than invented. Revenue is reported per currency rather than blended into
 * one number, since a creator can price different products in USD or EUR.
 */
export class AnalyticsService {
  constructor(private readonly prisma: PrismaClient) {}

  async getOverview(userId: string, period: AnalyticsPeriod) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const cutoff = periodToCutoff(period);
    const createdAtFilter = cutoff ? { gte: cutoff } : undefined;

    const purchases = await this.prisma.purchase.findMany({
      where: { status: "COMPLETED", createdAt: createdAtFilter, product: { creatorId: profile.id } },
      include: { product: { select: { id: true, title: true, slug: true, type: true, viewCount: true } } },
    });

    const donations = await this.prisma.donation.findMany({
      where: { status: "COMPLETED", createdAt: createdAtFilter, creatorId: profile.id },
    });

    const subscriptions = await this.prisma.subscription.findMany({
      where: { tier: { creatorId: profile.id }, payment: { status: "CONFIRMED", createdAt: createdAtFilter } },
      include: { payment: true },
    });

    const activeSubscriberCount = await this.prisma.subscription.count({
      where: { tier: { creatorId: profile.id }, status: "ACTIVE" },
    });

    // Rewards readers paid for (a free one is no income), counted as their
    // own source. One bought with a subscription rides on that payment, so
    // it is taken out of the subscription's figure rather than counted twice.
    const rewards = await this.prisma.rewardGift.findMany({
      where: { creatorId: profile.id, status: "GRANTED", amountMinor: { gt: 0n }, grantedAt: createdAtFilter },
      select: { amountMinor: true, currency: true },
    });
    const subscriptionPaymentIds = subscriptions.flatMap((s) => (s.payment ? [s.payment.id] : []));
    const rewardOnPayment = new Map<string, bigint>();
    for (const gift of await this.prisma.rewardGift.findMany({
      where: { paymentId: { in: subscriptionPaymentIds }, status: "GRANTED" },
      select: { paymentId: true, amountMinor: true },
    })) {
      rewardOnPayment.set(gift.paymentId!, (rewardOnPayment.get(gift.paymentId!) ?? 0n) + gift.amountMinor);
    }

    const revenueByType: Record<string, Record<string, string>> = {};
    for (const type of ["POST", "BUNDLE", "STICKER_PACK", "DIGITAL_FILE"]) {
      revenueByType[type] = sumByCurrency(purchases.filter((p) => p.product.type === type));
    }

    const purchasesByCurrency = sumByCurrency(purchases);
    const donationsByCurrency = sumByCurrency(donations);
    const subscriptionsByCurrency = sumByCurrency(
      subscriptions
        .filter((s) => s.payment)
        .map((s) => ({ amountMinor: s.payment!.amountMinor - (rewardOnPayment.get(s.payment!.id) ?? 0n), currency: s.payment!.currency })),
    );
    const rewardsByCurrency = sumByCurrency(rewards);
    const grossByCurrency = addTotals(
      addTotals(addTotals(purchasesByCurrency, donationsByCurrency), subscriptionsByCurrency),
      rewardsByCurrency,
    );

    const byProduct = new Map<
      string,
      { productId: string; title: string; slug: string; type: string; currency: string; revenueMinor: bigint; purchaseCount: number; viewCount: number }
    >();
    for (const p of purchases) {
      const existing = byProduct.get(p.productId);
      if (existing) {
        existing.revenueMinor += p.amountMinor;
        existing.purchaseCount += 1;
      } else {
        byProduct.set(p.productId, {
          productId: p.productId,
          title: p.product.title,
          slug: p.product.slug,
          type: p.product.type,
          currency: p.currency,
          revenueMinor: p.amountMinor,
          purchaseCount: 1,
          viewCount: p.product.viewCount,
        });
      }
    }
    const topProducts = [...byProduct.values()]
      .sort((a, b) => (b.revenueMinor > a.revenueMinor ? 1 : -1))
      .slice(0, 10)
      .map((p) => ({
        ...p,
        revenueMinor: p.revenueMinor.toString(),
        conversionRate: p.viewCount > 0 ? p.purchaseCount / p.viewCount : null,
      }));

    return {
      period,
      revenue: {
        grossByCurrency,
        bySource: {
          purchases: purchasesByCurrency,
          donations: donationsByCurrency,
          subscriptions: subscriptionsByCurrency,
          rewards: rewardsByCurrency,
        },
        byProductType: revenueByType,
      },
      counts: {
        purchases: purchases.length,
        donations: donations.length,
        activeSubscribers: activeSubscriberCount,
        newSubscriptionPayments: subscriptions.length,
        rewards: rewards.length,
      },
      topProducts,
    };
  }
}
