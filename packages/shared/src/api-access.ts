/**
 * What a contribution for programmatic API access has to be, shared so
 * the form's stated range and the server's validation cannot drift.
 * These are minor units — the platform never does currency arithmetic in
 * floats.
 */
export const API_ACCESS_MIN_MINOR = 500n; // $5
export const API_ACCESS_MAX_MINOR = 2000n; // $20

export function isApiAccessAmountInRange(amountMinor: bigint): boolean {
  return amountMinor >= API_ACCESS_MIN_MINOR && amountMinor <= API_ACCESS_MAX_MINOR;
}
