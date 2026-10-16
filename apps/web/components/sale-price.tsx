"use client";

import { saleActive, salePrice, type Sale } from "@platform/shared";
import { formatMoney } from "@/lib/money";
import { useLocale } from "./locale-provider";
import { formatDate } from "@/lib/dates";

/**
 * A price, and when the author has a sale on, the old one struck through
 * beside the new one and the percentage. The new one is computed by the
 * same function the checkout charges with.
 */
export function SalePrice({ amountMinor, currency, sale, suffix }: { amountMinor: string; currency: string; sale: Sale; suffix?: string }) {
  const { t, locale } = useLocale();
  if (!saleActive(sale)) {
    return (
      <span className="price-tag">
        {formatMoney(amountMinor, currency)}
        {suffix}
      </span>
    );
  }
  const now = salePrice(BigInt(amountMinor), sale).toString();
  return (
    <span className="price-tag sale">
      <s aria-label={t("sale.was")}>{formatMoney(amountMinor, currency)}</s> <strong>{formatMoney(now, currency)}</strong>
      {suffix}
      <span className="sale-badge" title={sale.discountEndsAt ? t("sale.until", { date: formatDate(sale.discountEndsAt, locale) }) : undefined}>
        −{sale.discountPercent}%
      </span>
    </span>
  );
}

/** The price as one string — the discounted one when a sale is on. */
export function saleText(amountMinor: string, currency: string, sale: Sale): string {
  if (!saleActive(sale)) return formatMoney(amountMinor, currency);
  return `${formatMoney(salePrice(BigInt(amountMinor), sale).toString(), currency)} (−${sale.discountPercent}%)`;
}
