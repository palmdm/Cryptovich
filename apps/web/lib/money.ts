import { Money, type Currency } from "@platform/shared";

/**
 * The single place the frontend turns minor-unit amounts into a display
 * string — it delegates the actual arithmetic/precision handling to the
 * same `Money` class the backend uses (`@platform/shared`), rather than
 * every page hand-rolling `Number(amountMinor) / 100`, which silently
 * assumes every currency uses exactly 2 decimal places (spec rule #147 —
 * the frontend never computes a price, only displays what the backend
 * returned).
 */
export function formatMoney(amountMinor: string | bigint, currency: string): string {
  const money = Money.fromMinor(BigInt(amountMinor), currency as Currency);
  // "$2.5" reads as a typo on a price tag: a fractional amount shows at
  // least two places ("$2.50"), a whole one none ("$5").
  const [whole, fraction] = money.toDecimalString().split(".");
  const amount = fraction ? `${whole}.${fraction.padEnd(2, "0")}` : whole!;
  // A symbol where there is a familiar one; the code otherwise, so an
  // unusual currency still reads unambiguously. "USD 1" is technically
  // right and looks like a database field.
  const symbol: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", JPY: "¥", RUB: "₽" };
  const sign = symbol[currency.toUpperCase()];
  return sign ? `${sign}${amount}` : `${currency} ${amount}`;
}
