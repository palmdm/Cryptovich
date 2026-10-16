import type { Redis } from "ioredis";
import { verifyTotp } from "./totp.js";
import { Errors } from "./errors.js";

const MAX_FAILURES = 10;
const LOCK_SECONDS = 15 * 60;
const failuresKey = (userId: string) => `2fa-failures:${userId}`;

/**
 * Checks a two-factor code, counting wrong ones per account — not per
 * address: the code is six digits, and whoever has the password (or a
 * session) can spread guesses over every address they have. Ten wrong in
 * a row shut the door for a quarter hour.
 */
export async function verifyTotpLimited(
  redis: Redis | undefined,
  user: { id: string; twoFactorSecret: string | null },
  code: string,
): Promise<void> {
  const failures = redis ? Number((await redis.get(failuresKey(user.id))) ?? 0) : 0;
  if (failures >= MAX_FAILURES) throw Errors.tooManyTwoFactorAttempts();
  if (!user.twoFactorSecret || !verifyTotp(user.twoFactorSecret, code)) {
    await redis?.multi().incr(failuresKey(user.id)).expire(failuresKey(user.id), LOCK_SECONDS).exec();
    throw Errors.invalidTwoFactorCode();
  }
  if (failures > 0) await redis?.del(failuresKey(user.id));
}
