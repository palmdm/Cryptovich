import type { PrismaClient } from "@platform/db";
import { notesFor } from "@platform/shared/node";
import { z } from "zod";
import { Errors } from "../../lib/errors.js";
import { logAdminAction } from "../../lib/audit-log.js";
import { isReactionEmoji, reactionShortcode } from "@platform/shared";
import { assertMayReactWith } from "../rewards/service.js";

export { isReactionEmoji };

export const announcementInputSchema = z.object({
  text: z.string().trim().min(1).max(5000),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().nullable().optional(),
});

/**
 * Announcements from the server, the way Mastodon shows them over the home
 * column: what is new, what changed, what the operator wants readers to
 * know. An administrator writes them; the API adds one by itself each time
 * a new Cryptovich version first starts, whose words are that version's release
 * notes in the reader's language (the page has them; `text` stays empty).
 */
export class AnnouncementService {
  constructor(private readonly prisma: PrismaClient) {}

  /** What a reader sees now: started, not ended, newest first. */
  async listActive(userId: string | null) {
    const now = new Date();
    const rows = await this.prisma.announcement.findMany({
      where: { startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      orderBy: { startsAt: "desc" },
      take: 20,
      include: { reactions: { select: { emoji: true, userId: true } } },
    });
    return rows.map((row) => this.present(row, userId));
  }

  private present(
    row: { id: string; text: string | null; version: string | null; startsAt: Date; endsAt: Date | null; reactions: { emoji: string; userId: string }[] },
    userId: string | null,
  ) {
    const counts = new Map<string, { emoji: string; count: number; mine: boolean }>();
    for (const reaction of row.reactions) {
      const entry = counts.get(reaction.emoji) ?? { emoji: reaction.emoji, count: 0, mine: false };
      entry.count += 1;
      if (reaction.userId === userId) entry.mine = true;
      counts.set(reaction.emoji, entry);
    }
    return {
      id: row.id,
      text: row.text,
      version: row.version,
      // A release's notes are the operator's own words from CHANGELOG.md,
      // read when shown — so a correction there reaches readers on restart.
      notes: row.version ? notesFor(row.version) : null,
      publishedAt: row.startsAt,
      endsAt: row.endsAt,
      reactions: [...counts.values()].sort((a, b) => b.count - a.count),
    };
  }

  /** Adds this reader's emoji to an announcement, or takes it back. */
  async toggleReaction(userId: string, announcementId: string, emoji: string) {
    if (!isReactionEmoji(emoji)) throw Errors.validation("That is not an emoji.");
    const announcement = await this.prisma.announcement.findUnique({ where: { id: announcementId } });
    if (!announcement) throw Errors.notFound("Announcement");
    const existing = await this.prisma.announcementReaction.findUnique({
      where: { announcementId_userId_emoji: { announcementId, userId, emoji } },
    });
    if (existing) {
      await this.prisma.announcementReaction.delete({ where: { id: existing.id } });
    } else {
      // A reader's reactions to one announcement are few; this keeps a
      // script from piling hundreds of emoji onto it.
      const shortcode = reactionShortcode(emoji);
      if (shortcode) await assertMayReactWith(this.prisma, shortcode, userId);
      const mine = await this.prisma.announcementReaction.count({ where: { announcementId, userId } });
      if (mine >= 10) throw Errors.validation("That is enough reactions for one announcement.");
      await this.prisma.announcementReaction.create({ data: { announcementId, userId, emoji } });
    }
    const row = await this.prisma.announcement.findUniqueOrThrow({
      where: { id: announcementId },
      include: { reactions: { select: { emoji: true, userId: true } } },
    });
    return this.present(row, userId);
  }

  async listAll() {
    return this.prisma.announcement.findMany({ orderBy: { startsAt: "desc" }, take: 200 });
  }

  async create(adminId: string, input: z.infer<typeof announcementInputSchema>) {
    const row = await this.prisma.announcement.create({
      data: { text: input.text, startsAt: input.startsAt ?? new Date(), endsAt: input.endsAt ?? null, createdById: adminId },
    });
    await logAdminAction(this.prisma, adminId, "ANNOUNCEMENT_CREATED", "Announcement", row.id);
    // So that everyone sees it, not only who opens the site while it shows:
    // a notification for every account (and so a push, from the worker).
    // One that starts later is not announced ahead of itself.
    if (row.text && row.startsAt.getTime() <= Date.now() + 60_000) await this.notifyEveryone(row.id, row.text, adminId);
    return row;
  }

  /** One notification per active account, written a thousand at a time. */
  private async notifyEveryone(announcementId: string, text: string, authorId: string) {
    const excerpt = text.replace(/\s+/g, " ").trim().slice(0, 140);
    let cursor: string | undefined;
    for (;;) {
      const users = await this.prisma.user.findMany({
        where: { deletedAt: null, suspendedAt: null, id: { not: authorId } },
        select: { id: true },
        orderBy: { id: "asc" },
        take: 1000,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (users.length === 0) break;
      await this.prisma.notification.createMany({
        data: users.map((u) => ({ userId: u.id, type: "ANNOUNCEMENT", payload: { announcementId, excerpt } })),
      });
      cursor = users[users.length - 1]!.id;
    }
  }

  async update(adminId: string, id: string, input: Partial<z.infer<typeof announcementInputSchema>>) {
    const existing = await this.prisma.announcement.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound("Announcement");
    const row = await this.prisma.announcement.update({
      where: { id },
      data: { text: input.text, startsAt: input.startsAt, endsAt: input.endsAt === undefined ? undefined : input.endsAt },
    });
    await logAdminAction(this.prisma, adminId, "ANNOUNCEMENT_UPDATED", "Announcement", id);
    return row;
  }

  async remove(adminId: string, id: string) {
    const existing = await this.prisma.announcement.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound("Announcement");
    await this.prisma.announcement.delete({ where: { id } });
    await logAdminAction(this.prisma, adminId, "ANNOUNCEMENT_DELETED", "Announcement", id);
  }

  /**
   * The "updated to vX" announcement, once per version: the first start of
   * a new version adds it, every later start finds it there. Deleting it in
   * the admin area is honoured — it is not made again for that version.
   */
  async ensureReleaseAnnouncement(version: string): Promise<boolean> {
    const marker = `releaseAnnounced:${version}`;
    const seen = await this.prisma.serverSetting.findUnique({ where: { key: marker } });
    if (seen) return false;
    await this.prisma.$transaction([
      this.prisma.serverSetting.createMany({ data: [{ key: marker, value: new Date().toISOString() }], skipDuplicates: true }),
      this.prisma.announcement.createMany({ data: [{ version }], skipDuplicates: true }),
    ]);
    return true;
  }
}
