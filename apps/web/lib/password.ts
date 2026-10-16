const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()-_=+";

/**
 * A random password strong enough to be someone's only credential —
 * `crypto.getRandomValues` (not `Math.random`, which is not
 * cryptographically secure) with rejection sampling, so every character
 * is drawn uniformly from CHARSET rather than biased toward its low end
 * by a naive `% CHARSET.length`.
 */
export function generateStrongPassword(length = 20): string {
  const bytes = new Uint8Array(length);
  let out = "";
  // The largest multiple of CHARSET.length that still fits a byte — a
  // raw byte above this is rejected and redrawn instead of being folded
  // in with `%`, which is what keeps every character equally likely.
  const max = 256 - (256 % CHARSET.length);
  while (out.length < length) {
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (out.length >= length) break;
      if (b < max) out += CHARSET[b % CHARSET.length];
    }
  }
  return out;
}

export type PasswordStrengthLabel = "weak" | "fair" | "good" | "strong";

export interface PasswordStrength {
  /** 0-5: how many complexity checks the password passed. */
  score: number;
  ratio: number;
  label: PasswordStrengthLabel;
}

/**
 * A live complexity read, not a policy — the API's own `min(10)` on
 * `password` (apps/api/src/modules/auth/schemas.ts) is what's actually
 * enforced; this is only feedback so a supporter picking their own
 * password (rather than using the generator) can see if it's thin before
 * they submit and get rejected, or worse, get accepted at 10 flat
 * characters and regret it later.
 */
export function passwordStrength(password: string): PasswordStrength {
  const checks = [
    password.length >= 10,
    password.length >= 16,
    /[a-z]/.test(password) && /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^a-zA-Z0-9]/.test(password),
  ];
  const score = password.length === 0 ? 0 : checks.filter(Boolean).length;
  const label: PasswordStrengthLabel = score <= 1 ? "weak" : score <= 2 ? "fair" : score <= 4 ? "good" : "strong";
  return { score, ratio: score / checks.length, label };
}
