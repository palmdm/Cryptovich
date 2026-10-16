import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@platform/db";
import { AppError, Errors } from "../../lib/errors.js";
import { withScopeLock } from "../../lib/scope-lock.js";

/** What an ordinary member may hold at once, and how long a code lives by default. */
export const MEMBER_INVITE_LIMITS = { maxActive: 10, maxUses: 10, maxDays: 90, defaultDays: 30 } as const;

/**
 * Registration is closed: a code is the entire authorisation to create an
 * account, so it is generated and handled like a secret rather than like
 * a coupon.
 *
 * 160 bits from a CSPRNG, rendered in Crockford base32 (no I/L/O/U, so it
 * survives being read aloud or copied off a screen) and grouped for
 * legibility:
 *
 *   4TIP-K7M2N-9PQRS-3TVWX-Y4Z6A-B8CDE-FGH2J
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const GROUPS = 6;
const GROUP_LEN = 5;

export function generateInviteCode(): string {
  const needed = GROUPS * GROUP_LEN;
  const out: string[] = [];
  // Rejection-free because 32 divides 256 evenly — every byte maps to one
  // symbol with no modulo bias.
  const bytes = randomBytes(needed);
  for (let i = 0; i < needed; i += 1) {
    out.push(ALPHABET[bytes[i]! % ALPHABET.length]!);
  }
  const groups: string[] = [];
  for (let i = 0; i < GROUPS; i += 1) {
    groups.push(out.slice(i * GROUP_LEN, (i + 1) * GROUP_LEN).join(""));
  }
  return `4TIP-${groups.join("-")}`;
}

/**
 * Accepts what a human actually types — any case, spaces, missing or
 * extra dashes — and rebuilds the canonical stored form, so the lookup
 * stays a single indexed read instead of a scan. Returns null when the
 * input cannot be a code at all.
 */
export function canonicalizeInviteCode(raw: string): string | null {
  const stripped = raw.trim().toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (!stripped.startsWith("4TIP")) return null;
  const body = stripped.slice(4);
  if (body.length !== GROUPS * GROUP_LEN) return null;
  const groups: string[] = [];
  for (let i = 0; i < GROUPS; i += 1) {
    groups.push(body.slice(i * GROUP_LEN, (i + 1) * GROUP_LEN));
  }
  return `4TIP-${groups.join("-")}`;
}

export class InviteService {
  constructor(private prisma: PrismaClient) {}

  async create(issuedById: string, input: { note?: string; maxUses?: number | null; expiresInDays?: number | null }) {
    const code = generateInviteCode();
    return this.prisma.inviteCode.create({
      data: {
        code,
        issuedById,
        note: input.note,
        // Distinguishes "not specified" from an explicit null: omitting
        // the field means a single-use code, passing null means unlimited.
        maxUses: input.maxUses === undefined ? 1 : input.maxUses,
        expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000) : null,
      },
    });
  }

  async list() {
    const codes = await this.prisma.inviteCode.findMany({
      include: {
        issuedBy: { select: { username: true } },
        _count: { select: { redemptions: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return codes.map((c) => ({
      id: c.id,
      code: c.code,
      note: c.note,
      maxUses: c.maxUses,
      usedCount: c._count.redemptions,
      expiresAt: c.expiresAt,
      revokedAt: c.revokedAt,
      createdAt: c.createdAt,
      issuedBy: c.issuedBy?.username ?? null,
    }));
  }

  /**
   * A member's own codes, newest first, with who used them — the person
   * who brought someone in may see who that was.
   */
  async listForUser(userId: string) {
    const codes = await this.prisma.inviteCode.findMany({
      where: { issuedById: userId },
      include: {
        redemptions: { select: { user: { select: { username: true } }, createdAt: true }, orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return codes.map((c) => ({
      id: c.id,
      code: c.code,
      note: c.note,
      maxUses: c.maxUses,
      usedCount: c.redemptions.length,
      usedBy: c.redemptions.map((r) => r.user.username),
      expiresAt: c.expiresAt,
      revokedAt: c.revokedAt,
      createdAt: c.createdAt,
    }));
  }

  /**
   * Mints a code for an ordinary member. "How many live codes do they
   * hold" is a check-then-act, so it runs under a lock scoped to that
   * member — two tabs pressing the button at once cannot both pass it.
   */
  async createForUser(userId: string, input: { note?: string; maxUses?: number; expiresInDays?: number }) {
    const code = generateInviteCode();
    return withScopeLock(this.prisma, `member-invites:${userId}`, async (tx) => {
      const live = await tx.inviteCode.findMany({
        where: {
          issuedById: userId,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { maxUses: true, _count: { select: { redemptions: true } } },
      });
      const active = live.filter((c) => c.maxUses === null || c._count.redemptions < c.maxUses).length;
      if (active >= MEMBER_INVITE_LIMITS.maxActive) {
        throw new AppError(
          409,
          `You already have ${MEMBER_INVITE_LIMITS.maxActive} active invite codes. Revoke one or wait for one to be used.`,
          "INVITE_LIMIT",
        );
      }
      const days = input.expiresInDays ?? MEMBER_INVITE_LIMITS.defaultDays;
      return tx.inviteCode.create({
        data: {
          code,
          issuedById: userId,
          note: input.note,
          maxUses: input.maxUses ?? 1,
          expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
        },
      });
    });
  }

  /** Only the member who minted a code may revoke it here. */
  async revokeOwn(userId: string, id: string) {
    const existing = await this.prisma.inviteCode.findFirst({ where: { id, issuedById: userId } });
    if (!existing) throw Errors.notFound("Invite code");
    if (existing.revokedAt) return existing;
    return this.prisma.inviteCode.update({ where: { id }, data: { revokedAt: new Date() } });
  }

  /** Who brought this account in, or null (registered before invites, or with no code). */
  async inviterOf(username: string): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: { username, deletedAt: null },
      select: {
        inviteRedemptions: {
          take: 1,
          select: { inviteCode: { select: { issuedBy: { select: { username: true, deletedAt: true } } } } },
        },
      },
    });
    const issuer = user?.inviteRedemptions[0]?.inviteCode.issuedBy;
    return issuer && !issuer.deletedAt ? issuer.username : null;
  }

  async revoke(id: string) {
    const existing = await this.prisma.inviteCode.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound("Invite code");
    return this.prisma.inviteCode.update({ where: { id }, data: { revokedAt: new Date() } });
  }

  /**
   * Resolves a typed code to a usable invite, or throws. Every failure —
   * malformed, unknown, revoked, expired, exhausted — returns the same
   * message, so the endpoint can't be used to probe which codes exist.
   */
  async findRedeemable(rawCode: string) {
    const invalid = () => Errors.validation("That invite code isn't valid.");

    const code = canonicalizeInviteCode(rawCode);
    if (!code) throw invalid();

    const invite = await this.prisma.inviteCode.findUnique({
      where: { code },
      include: { _count: { select: { redemptions: true } } },
    });

    if (!invite) throw invalid();
    if (invite.revokedAt) throw invalid();
    if (invite.expiresAt && invite.expiresAt <= new Date()) throw invalid();
    if (invite.maxUses !== null && invite._count.redemptions >= invite.maxUses) throw invalid();

    return invite;
  }
}
