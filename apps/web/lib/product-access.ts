import type { ProductSummary } from "./types";
import type { TranslationKey } from "./i18n/en";
import { saleText } from "@/components/sale-price";

/**
 * Whether a card should show the lock instead of the post.
 *
 * The API decides this (`canAccess`) — visibility alone would lock a post
 * the reader has already paid for or subscribed to, and lock the author
 * out of their own posts. `canAccess` is absent only on responses that
 * predate it, where visibility is the best guess available.
 */
export function isLocked(product: ProductSummary): boolean {
  return product.canAccess === undefined ? product.visibility !== "PUBLIC" : !product.canAccess;
}

/**
 * What the lock is: a price to pay, or a tier to be on. A post sold for
 * money used to read "Available to supporters", which describes the other
 * kind of gate entirely.
 */
export function lockHeadingKey(product: ProductSummary): TranslationKey {
  if (product.visibility === "GOAL") return "lock.untilGoal";
  return product.visibility === "PURCHASED" ? "profile.paidPost" : "profile.forSupporters";
}

/**
 * What the lock says it costs. A price when there is one; otherwise what
 * the reader would have to be — a subscriber, or a member of a named
 * tier. It used to read "Free" for every gated post without a price,
 * which is the opposite of what the lock means.
 */
export function accessLabel(
  product: ProductSummary,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
): string {
  // Closed until the goal is reached: no price or tier opens it early.
  if (product.visibility === "GOAL") return product.requiredGoal?.title ?? t("lock.goalGone");
  const price = product.prices?.[0];
  if (price && price.pricingType !== "FREE") {
    return saleText(price.amountMinor, price.currency, { discountPercent: product.discountPercent ?? null, discountEndsAt: product.discountEndsAt ?? null });
  }
  if (product.visibility === "TIER" && product.requiredTier) return product.requiredTier.name;
  if (product.visibility === "TIER" || product.visibility === "SUBSCRIBERS") return t("profile.subscribersOnly");
  return t("common.free");
}
