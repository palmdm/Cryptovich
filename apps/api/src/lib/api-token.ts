import { randomBytes, createHash } from "node:crypto";
import type { PrismaClient } from "@platform/db";

const TOKEN_PREFIX = "pat_";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Mirrors `createSession`/`resolveSession` in lib/session.ts — only the
 * hash is ever persisted, the raw token is returned once and never
 * recoverable afterward. `pat_` prefix makes a leaked token
 * grep-detectable in logs/commits, the same convention GitHub/Stripe use. */
export async function createApiToken(prisma: PrismaClient, userId: string, name: string): Promise<{ token: string; id: string; name: string; createdAt: Date }> {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const created = await prisma.apiToken.create({
    data: { userId, name, tokenHash: hashToken(token) },
  });
  return { token, id: created.id, name: created.name, createdAt: created.createdAt };
}

export async function resolveApiToken(prisma: PrismaClient, token: string) {
  const tokenHash = hashToken(token);
  const apiToken = await prisma.apiToken.findUnique({ where: { tokenHash }, include: { user: true } });
  if (!apiToken) return null;
  if (apiToken.revokedAt) return null;
  if (apiToken.user.deletedAt) return null;
  if (apiToken.user.suspendedAt) return null;
  // Best-effort — a lookup that also had to write on every authenticated
  // request would slow every token-authenticated call down for a
  // "nice to have" timestamp; losing an update under contention is fine.
  prisma.apiToken.update({ where: { id: apiToken.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return apiToken;
}
