import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import type { PrismaClient, EmailTokenPurpose } from "@platform/db";

/** An hour is long enough to find the mail, short enough to matter if it leaks. */
export const EMAIL_TOKEN_TTL_MS = 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Mints a one-time link token. Same shape as sessions and API tokens:
 * the raw value is returned once, for the mail, and only its hash is
 * persisted — a database dump must not yield working reset links.
 *
 * Any earlier unused token for the same user and purpose is consumed
 * first, so requesting a second reset invalidates the first mail rather
 * than leaving two live links in two inboxes.
 */
export async function createEmailToken(
  prisma: PrismaClient,
  userId: string,
  purpose: EmailTokenPurpose,
  sentTo: string,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");

  await prisma.$transaction([
    prisma.emailToken.updateMany({
      where: { userId, purpose, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.emailToken.create({
      data: {
        userId,
        purpose,
        sentTo,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS),
      },
    }),
  ]);

  return token;
}

/**
 * Redeems a token, or returns null if it is unknown, expired, already
 * used, or belongs to a deleted account. Marking it used happens in the
 * same conditional update as the read, so two simultaneous clicks cannot
 * both succeed.
 */
export async function consumeEmailToken(
  prisma: PrismaClient,
  token: string,
  purpose: EmailTokenPurpose,
): Promise<{ userId: string; sentTo: string } | null> {
  const tokenHash = hashToken(token);
  const row = await prisma.emailToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, deletedAt: true } } },
  });
  if (!row || row.purpose !== purpose || row.usedAt || row.user.deletedAt) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;

  // Conditional on `usedAt` still being null: whichever request updates
  // the row first wins, and the loser sees a count of 0 rather than both
  // being allowed through.
  const claimed = await prisma.emailToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count === 0) return null;

  return { userId: row.user.id, sentTo: row.sentTo };
}

/**
 * Constant-time compare for values that are secrets but not hashed —
 * kept here so callers do not reach for `===` on a token.
 */
export function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
