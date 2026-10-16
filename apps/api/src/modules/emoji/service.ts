import type { PrismaClient } from "@platform/db";
import { Errors } from "../../lib/errors.js";
import { requireCreatorProfile } from "../products/product-helpers.js";
import type { CreateEmojiInput } from "./schemas.js";

/**
 * Custom emoji an author can use inline in their own posts and comments,
 * written as `:shortcode:`. Scoped to the author: two authors can both
 * have `:wave:` meaning different images, and neither can overwrite the
 * other's.
 *
 * Populated two ways — by hand, and automatically from a Sharkey emoji
 * import, which is where most of them come from.
 */
export class EmojiService {
  constructor(private readonly prisma: PrismaClient) {}

  async listMine(userId: string) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    return this.prisma.customEmoji.findMany({
      where: { creatorId: profile.id },
      orderBy: { shortcode: "asc" },
    });
  }

  /** Public: a reader's browser needs these to render a post's text. */
  async listForCreator(username: string) {
    const profile = await this.prisma.creatorProfile.findFirst({
      where: { user: { username, deletedAt: null } },
    });
    if (!profile) return [];
    const emoji = await this.prisma.customEmoji.findMany({
      where: { creatorId: profile.id },
      orderBy: { shortcode: "asc" },
    });
    return emoji.map((e) => ({ shortcode: e.shortcode, url: e.url }));
  }

  async add(userId: string, input: CreateEmojiInput) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const existing = await this.prisma.customEmoji.findUnique({
      where: { creatorId_shortcode: { creatorId: profile.id, shortcode: input.shortcode } },
    });
    if (existing) throw Errors.validation(`You already have an emoji called :${input.shortcode}:.`);

    return this.prisma.customEmoji.create({
      data: { creatorId: profile.id, shortcode: input.shortcode, url: input.url },
    });
  }

  async remove(userId: string, id: string) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const emoji = await this.prisma.customEmoji.findUnique({ where: { id } });
    if (!emoji || emoji.creatorId !== profile.id) throw Errors.notFound("Emoji");
    await this.prisma.customEmoji.delete({ where: { id } });
  }
}
