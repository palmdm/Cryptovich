import type { PrismaClient } from "@platform/db";
import { Money, type Currency } from "@platform/shared";

export class PricingService {
  constructor(private readonly prisma: PrismaClient) {}

  async getActivePrice(productId: string) {
    return this.prisma.productPrice.findFirst({
      where: { productId, active: true },
      orderBy: { createdAt: "desc" },
    });
  }

  toMoney(price: { amountMinor: bigint; currency: string }): Money {
    return Money.fromMinor(price.amountMinor, price.currency as Currency);
  }

  /**
   * Bundle pricing is always computed server-side: individual value is the
   * sum of each member product's active price (in the bundle's currency),
   * savings is individual value minus the bundle's own price. The frontend
   * never performs this arithmetic (spec rule #19 / #147).
   */
  async computeBundlePricing(bundleProductId: string) {
    const bundlePrice = await this.getActivePrice(bundleProductId);
    if (!bundlePrice) return null;
    const currency = bundlePrice.currency as Currency;

    const items = await this.prisma.productItem.findMany({
      where: { productId: bundleProductId },
      include: { itemProduct: { include: { prices: { where: { active: true } } } } },
    });

    let individualValue = Money.zero(currency);
    for (const item of items) {
      const price = item.itemProduct.prices.find((p) => p.currency === currency);
      if (price) individualValue = individualValue.add(this.toMoney(price));
    }

    const bundleMoney = this.toMoney(bundlePrice);
    const savings = individualValue.isGreaterThan(bundleMoney)
      ? individualValue.subtract(bundleMoney)
      : Money.zero(currency);

    return {
      currency,
      individualValueMinor: individualValue.amountMinor.toString(),
      bundlePriceMinor: bundleMoney.amountMinor.toString(),
      savingsMinor: savings.amountMinor.toString(),
      itemCount: items.length,
    };
  }
}
