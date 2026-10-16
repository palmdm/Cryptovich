import { randomUUID } from "node:crypto";
import { prisma } from "@platform/db";

/**
 * Identifies this worker process. Regenerated on every start, which is
 * what makes a restarted instance unable to release a lease it no longer
 * logically owns.
 */
const HOLDER = `${process.pid}-${randomUUID().slice(0, 8)}`;

/**
 * Runs `fn` only if this instance can take the named lease, and skips the
 * tick entirely otherwise. That is deliberately *not* a queue: two
 * instances polling the same job every 10 seconds should have one do the
 * work and the other move on, not pile up waiting to repeat it.
 *
 * `ttlMs` must exceed the job's realistic worst case. A crashed instance
 * releases nothing, so the lease lapsing is the only recovery — too short
 * and a second instance starts the job while the first is still running;
 * too long and a crash idles that job until it expires.
 */
export async function withJobLease<T>(name: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
  const expiresAt = new Date(Date.now() + ttlMs);

  // Atomic take-or-fail. The `WHERE` on the conflict path means an
  // unexpired lease held by anyone (including this instance) is left
  // alone, so the insert only wins when nobody holds one.
  const rows = await prisma.$queryRaw<Array<{ name: string }>>`
    INSERT INTO "WorkerLock" ("name", "holder", "expiresAt", "updatedAt")
    VALUES (${name}, ${HOLDER}, ${expiresAt}, now())
    ON CONFLICT ("name") DO UPDATE
      SET "holder" = EXCLUDED."holder",
          "expiresAt" = EXCLUDED."expiresAt",
          "updatedAt" = now()
      WHERE "WorkerLock"."expiresAt" < now()
    RETURNING "name"
  `;
  if (rows.length === 0) return null;

  try {
    return await fn();
  } finally {
    // Only ever releases our own lease: if it already lapsed and another
    // instance took over, this deletes nothing rather than cutting that
    // instance's run short.
    await prisma.workerLock
      .deleteMany({ where: { name, holder: HOLDER } })
      .catch(() => {});
  }
}
