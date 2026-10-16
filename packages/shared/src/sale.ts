/**
 * A sale an author puts on a tier or a paid post: a percentage off (1–90)
 * until an optional date. The price itself never changes — the discounted
 * one is worked out here, in whole minor units, so the page that shows it
 * and the checkout that charges it can never disagree.
 */
export interface Sale {
  discountPercent: number | null;
  discountEndsAt: Date | string | null;
}

export const SALE_MIN_PERCENT = 1;
export const SALE_MAX_PERCENT = 90;

export function saleActive(sale: Sale, now: Date = new Date()): boolean {
  const percent = sale.discountPercent;
  if (percent === null || !Number.isInteger(percent) || percent < SALE_MIN_PERCENT || percent > SALE_MAX_PERCENT) return false;
  return sale.discountEndsAt === null || new Date(sale.discountEndsAt).getTime() > now.getTime();
}

/** The price to pay: rounded to the nearest minor unit, and never below one of them for a price above zero. */
export function salePrice(amountMinor: bigint, sale: Sale, now: Date = new Date()): bigint {
  if (amountMinor <= 0n || !saleActive(sale, now)) return amountMinor;
  const discounted = (amountMinor * BigInt(100 - sale.discountPercent!) + 50n) / 100n;
  return discounted < 1n ? 1n : discounted;
}
