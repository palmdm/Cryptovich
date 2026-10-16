/**
 * Money abstraction. All amounts are stored as integer minor units (cents,
 * satoshis-equivalent for crypto display, etc.) — never as floats. This is
 * the single source of truth for arithmetic; nothing in the frontend is
 * permitted to compute or mutate a price.
 */

export type FiatCurrency = "USD" | "EUR";
export type CryptoCurrency = "BTC" | "ETH" | "USDT" | "USDC";
export type Currency = FiatCurrency | CryptoCurrency;

export const FIAT_CURRENCIES: readonly FiatCurrency[] = ["USD", "EUR"];
export const CRYPTO_CURRENCIES: readonly CryptoCurrency[] = ["BTC", "ETH", "USDT", "USDC"];

const MINOR_UNIT_EXPONENT: Record<Currency, number> = {
  USD: 2,
  EUR: 2,
  BTC: 8,
  ETH: 18,
  USDT: 6,
  USDC: 6,
};

export class Money {
  private constructor(
    public readonly amountMinor: bigint,
    public readonly currency: Currency,
  ) {
    if (amountMinor < 0n) {
      throw new Error("Money amount cannot be negative");
    }
  }

  static fromMinor(amountMinor: bigint | number, currency: Currency): Money {
    return new Money(BigInt(amountMinor), currency);
  }

  /** Parse a decimal string ("19.99") into minor units for the given currency. */
  static fromDecimalString(decimal: string, currency: Currency): Money {
    const exponent = MINOR_UNIT_EXPONENT[currency];
    const [whole = "0", frac = ""] = decimal.trim().split(".");
    const paddedFrac = (frac + "0".repeat(exponent)).slice(0, exponent);
    const sign = whole.startsWith("-") ? -1n : 1n;
    const wholeAbs = whole.replace("-", "") || "0";
    const amount = (BigInt(wholeAbs) * 10n ** BigInt(exponent) + BigInt(paddedFrac || "0")) * sign;
    return new Money(amount, currency);
  }

  static zero(currency: Currency): Money {
    return new Money(0n, currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amountMinor + other.amountMinor, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    const result = this.amountMinor - other.amountMinor;
    if (result < 0n) throw new Error("Money subtraction would be negative");
    return new Money(result, this.currency);
  }

  /** Multiply by a rational factor expressed as integer basis points (1/10000). */
  multiplyBasisPoints(bps: number): Money {
    return new Money((this.amountMinor * BigInt(bps)) / 10_000n, this.currency);
  }

  isZero(): boolean {
    return this.amountMinor === 0n;
  }

  isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amountMinor > other.amountMinor;
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amountMinor < other.amountMinor;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amountMinor === other.amountMinor;
  }

  toDecimalString(): string {
    const exponent = MINOR_UNIT_EXPONENT[this.currency];
    const negative = this.amountMinor < 0n;
    const abs = negative ? -this.amountMinor : this.amountMinor;
    const divisor = 10n ** BigInt(exponent);
    const whole = abs / divisor;
    const frac = (abs % divisor).toString().padStart(exponent, "0").replace(/0+$/, "");
    return `${negative ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
  }

  toJSON() {
    return { amountMinor: this.amountMinor.toString(), currency: this.currency };
  }

  private assertSameCurrency(other: Money) {
    if (other.currency !== this.currency) {
      throw new Error(`Currency mismatch: ${this.currency} vs ${other.currency}`);
    }
  }
}

/**
 * Donation bounds, shared so the tip panel's stated range and the
 * server's validation can never drift apart. Below the minimum a
 * payment costs more in fees than it delivers; the ceiling is a
 * fat-finger guard, not a policy limit.
 */
export const DONATION_MIN_DECIMAL = 1;
export const DONATION_MAX_DECIMAL = 100_000;

export function isDonationAmountInRange(amountDecimal: string): boolean {
  const value = Number(amountDecimal);
  return Number.isFinite(value) && value >= DONATION_MIN_DECIMAL && value <= DONATION_MAX_DECIMAL;
}
