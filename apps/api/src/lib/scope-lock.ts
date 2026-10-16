import type { Prisma, PrismaClient } from "@platform/db";

/**
 * Serializes a check-then-act sequence against concurrent requests for the
 * SAME scope, while leaving unrelated scopes free to run in parallel — a
 * Postgres advisory lock held for the transaction's lifetime
 * (`pg_advisory_xact_lock`, auto-released on commit/rollback, no separate
 * unlock call needed).
 *
 * Used wherever reading a count and then writing a row that changes it
 * must not interleave: checkout ("does a pending purchase already exist")
 * and invite redemption ("are there uses left").
 *
 * Do nothing slow inside `fn` — password hashing, network calls — since
 * the lock is held for its whole duration.
 */
export async function withScopeLock<T>(
  prisma: PrismaClient,
  scopeKey: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scopeKey})::bigint)`;
    return fn(tx);
  });
}
