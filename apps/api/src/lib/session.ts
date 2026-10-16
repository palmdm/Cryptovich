import { randomBytes, createHash } from "node:crypto";
import type { PrismaClient } from "@platform/db";
import { config } from "../config.js";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type SessionMethod = "password" | "qr" | "passkey";

/**
 * A temporary session's lifetime, renewed by every request it makes (the
 * web app asks /auth/me every minute while a tab is open). Close the last
 * tab and it simply runs out; its cookie, set without an expiry, is gone
 * with the browser anyway.
 */
export const EPHEMERAL_TTL_MS = 3 * 60 * 1000;
/** Renewed at most this often, not on every request. */
const EPHEMERAL_RENEW_AFTER_MS = 30 * 1000;

export async function createSession(
  prisma: PrismaClient,
  userId: string,
  meta: { userAgent?: string; ipHash?: string },
  options: { method?: SessionMethod; ephemeral?: boolean } = {},
): Promise<{ token: string; expiresAt: Date; ephemeral: boolean }> {
  const token = randomBytes(32).toString("base64url");
  const ephemeral = options.ephemeral ?? false;
  const expiresAt = new Date(Date.now() + (ephemeral ? EPHEMERAL_TTL_MS : config.sessionTtlSeconds * 1000));
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: meta.userAgent?.slice(0, 255),
      ipHash: meta.ipHash,
      method: options.method ?? "password",
      ephemeral,
    },
  });
  return { token, expiresAt, ephemeral };
}

/** Keeps a temporary session alive while it is in use. */
export async function renewEphemeral(prisma: PrismaClient, session: { id: string; ephemeral: boolean; expiresAt: Date }) {
  if (!session.ephemeral) return;
  if (session.expiresAt.getTime() - Date.now() > EPHEMERAL_TTL_MS - EPHEMERAL_RENEW_AFTER_MS) return;
  await prisma.session.updateMany({
    where: { id: session.id, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { expiresAt: new Date(Date.now() + EPHEMERAL_TTL_MS) },
  });
}

export async function resolveSession(prisma: PrismaClient, token: string) {
  const tokenHash = hashToken(token);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt < new Date()) return null;
  if (session.user.deletedAt) return null;
  if (session.user.suspendedAt) return null;
  return session;
}

export async function revokeSession(prisma: PrismaClient, token: string): Promise<void> {
  const tokenHash = hashToken(token);
  await prisma.session.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function sessionIdFor(prisma: PrismaClient, token: string): Promise<string | null> {
  const row = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, select: { id: true } });
  return row?.id ?? null;
}

export function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

/** Newest first. Every row is a sign-in, kept after it ends, so the list doubles as the account's login history. */
export const LOGIN_HISTORY_LIMIT = 50;
