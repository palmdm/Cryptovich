import type { PrismaClient } from "@platform/db";
import { Errors } from "../../lib/errors.js";

/**
 * Following an author for free — keeping up with what they publish, with
 * no tier and no payment. A follow opens nothing: a gated post stays
 * gated. It only decides whose new posts reach a reader's feed, their
 * notifications and their Telegram.
 */
export class FollowService {
  constructor(private readonly prisma: PrismaClient) {}

  private async creator(username: string) {
    const creator = await this.prisma.creatorProfile.findFirst({
      where: { user: { username, deletedAt: null } },
      select: { id: true, userId: true },
    });
    if (!creator) throw Errors.notFound("Creator");
    return creator;
  }

  private followers(creatorId: string) {
    return this.prisma.follow.count({ where: { creatorId } });
  }

  async status(userId: string | null, username: string) {
    const creator = await this.creator(username);
    const [mine, followers] = await Promise.all([
      userId ? this.prisma.follow.findUnique({ where: { userId_creatorId: { userId, creatorId: creator.id } } }) : null,
      this.followers(creator.id),
    ]);
    return { following: mine !== null, followers };
  }

  async follow(userId: string, username: string) {
    const creator = await this.creator(username);
    if (creator.userId === userId) throw Errors.validation("You cannot follow your own page.");
    await this.prisma.follow.upsert({
      where: { userId_creatorId: { userId, creatorId: creator.id } },
      create: { userId, creatorId: creator.id },
      update: {},
    });
    return { following: true, followers: await this.followers(creator.id) };
  }

  async unfollow(userId: string, username: string) {
    const creator = await this.creator(username);
    await this.prisma.follow.deleteMany({ where: { userId, creatorId: creator.id } });
    return { following: false, followers: await this.followers(creator.id) };
  }

  /** The authors a reader follows, newest first. */
  async listMine(userId: string) {
    const rows = await this.prisma.follow.findMany({
      where: { userId, creator: { user: { deletedAt: null } } },
      orderBy: { createdAt: "desc" },
      select: {
        createdAt: true,
        creator: { select: { displayName: true, avatarUrl: true, avatarFrame: true, user: { select: { username: true } } } },
      },
    });
    return rows.map((r) => ({
      username: r.creator.user.username,
      displayName: r.creator.displayName,
      avatarUrl: r.creator.avatarUrl,
      avatarFrame: r.creator.avatarFrame,
      since: r.createdAt,
    }));
  }
}

/**
 * Who hears of an author's new post: everyone subscribed to them (free
 * tiers included) and everyone following them — each once, never the
 * author themselves.
 */
export async function newPostAudience(prisma: PrismaClient, creatorId: string, authorUserId: string): Promise<string[]> {
  const [subscribers, followers] = await Promise.all([
    prisma.subscription.findMany({
      where: { status: "ACTIVE", expiresAt: { gt: new Date() }, tier: { creatorId } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.follow.findMany({ where: { creatorId }, select: { userId: true } }),
  ]);
  const ids = new Set([...subscribers.map((s) => s.userId), ...followers.map((f) => f.userId)]);
  ids.delete(authorUserId);
  return [...ids];
}
