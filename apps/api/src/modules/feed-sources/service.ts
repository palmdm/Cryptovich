import type { PrismaClient } from "@platform/db";
import type { FeedIngestionProvider } from "@platform/integrations";
import { Errors } from "../../lib/errors.js";
import { requireCreatorProfile } from "../products/product-helpers.js";
import { resolveFeedProvider } from "./provider-factory.js";
import { ActivityPubService } from "../activitypub/service.js";
import type { CreateFeedSourceInput } from "./schemas.js";

export class FeedSourceService {
  /**
   * `provider` overrides the per-platform resolution entirely; tests pass
   * a mock so nothing reaches the network.
   */
  constructor(
    private readonly prisma: PrismaClient,
    private readonly provider?: FeedIngestionProvider,
  ) {}

  /**
   * Verifies the actor URL actually resolves before persisting it — the
   * same fail-closed connect-then-verify shape `ConnectionService.connect`
   * uses for sticker imports, so a typo'd handle never sits there silently
   * "connected" but never actually ingesting anything.
   */
  async create(userId: string, input: CreateFeedSourceInput) {
    const profile = await requireCreatorProfile(this.prisma, userId);

    try {
      const sign = input.platform === "RSS" ? undefined : await new ActivityPubService(this.prisma).fetchSigner().catch(() => undefined);
      const provider = this.provider ?? resolveFeedProvider(input.platform, sign);
      await provider.fetchRecentPosts(input.actorUrl);
    } catch (err) {
      throw Errors.validation(err instanceof Error ? err.message : "Could not verify that account.");
    }

    return this.prisma.feedSource.upsert({
      where: { creatorId_platform_actorUrl: { creatorId: profile.id, platform: input.platform, actorUrl: input.actorUrl } },
      update: { active: true, lastError: null },
      create: { creatorId: profile.id, platform: input.platform, actorUrl: input.actorUrl },
    });
  }

  async listMine(userId: string) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const sources = await this.prisma.feedSource.findMany({ where: { creatorId: profile.id }, orderBy: { createdAt: "desc" } });
    // How many of each source's posts are still on the page — what
    // "delete the imported posts" would take away.
    return Promise.all(
      sources.map(async (source) => ({ ...source, importedPosts: (await this.importedPostIds(profile.id, source.id)).length })),
    );
  }

  /** The author's posts still standing that came from this source. */
  private async importedPostIds(creatorId: string, sourceId: string): Promise<string[]> {
    const items = await this.prisma.feedImportedItem.findMany({ where: { feedSourceId: sourceId, productId: { not: null } }, select: { productId: true } });
    if (items.length === 0) return [];
    const posts = await this.prisma.digitalProduct.findMany({
      where: { id: { in: items.map((i) => i.productId!) }, creatorId, deletedAt: null },
      select: { id: true },
    });
    return posts.map((p) => p.id);
  }

  /**
   * Deletes, in one go, every post a disconnected source brought in — the
   * way deleting them one by one would (they leave the page and the
   * fediverse; files go with the nightly clean-up). The source's ledger
   * stays, so reconnecting it does not bring the same posts back.
   */
  async removeImportedPosts(userId: string, id: string): Promise<number> {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const source = await this.prisma.feedSource.findUnique({ where: { id } });
    if (!source || source.creatorId !== profile.id) throw Errors.notFound("Feed source");
    if (source.active) throw Errors.validation("Disconnect the feed before deleting what it brought in.");
    const ids = await this.importedPostIds(profile.id, id);
    if (ids.length === 0) return 0;
    const { count } = await this.prisma.digitalProduct.updateMany({
      where: { id: { in: ids } },
      data: { deletedAt: new Date(), status: "ARCHIVED", featured: false, featuredPosition: null },
    });
    return count;
  }

  async remove(userId: string, id: string) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const source = await this.prisma.feedSource.findUnique({ where: { id } });
    if (!source || source.creatorId !== profile.id) throw Errors.notFound("Feed source");
    await this.prisma.feedSource.update({ where: { id }, data: { active: false } });
  }
}
