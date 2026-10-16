import { prisma, type FeedSourcePlatform } from "@platform/db";
import { ActivityPubFeedProvider, RssFeedProvider, type FeedIngestionProvider } from "@platform/integrations";
import { uniqueSlug } from "../lib/slug.js";
import { instanceSigner } from "../lib/instance-signer.js";
import { importedTitleAndBody } from "../lib/imported-title.js";

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Which provider speaks a given source's protocol. Mastodon and Sharkey
 * are both ActivityPub; RSS covers everything else an author might already
 * be publishing to — a blog, a newsletter, a podcast.
 */
export type FeedProviders = Partial<Record<FeedSourcePlatform, FeedIngestionProvider>>;

async function defaultProviders(): Promise<FeedProviders> {
  // Signed as this server's instance actor: a server in authorized-fetch
  // mode refuses an unsigned read of an outbox.
  const sign = await instanceSigner().catch(() => undefined);
  const activityPub = new ActivityPubFeedProvider(undefined, sign);
  return { MASTODON: activityPub, SHARKEY: activityPub, RSS: new RssFeedProvider() };
}

/**
 * Dual-feed ingestion: for each active `FeedSource`, pulls the remote
 * account's recent public posts and mirrors any not already seen
 * (deduped via `FeedImportedItem`) into the creator's own feed as a
 * PUBLIC, already-`PUBLISHED` `POST` — free content that sits alongside
 * whatever paid posts the creator writes directly here (spec: "paid posts
 * are already specifically written here"). Never runs inline in an API
 * request.
 */
export async function ingestExternalFeeds(given?: FeedProviders): Promise<number> {
  const due = await prisma.feedSource.findMany({
    where: {
      active: true,
      OR: [{ lastFetchedAt: null }, { lastFetchedAt: { lt: new Date(Date.now() - REFRESH_INTERVAL_MS) } }],
    },
    // A source never fetched goes first, then the one waiting longest. With
    // no order, which five came back was up to the database, and a new
    // source could sit behind older ones tick after tick.
    orderBy: [{ lastFetchedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
    take: 5,
  });

  if (due.length === 0) return 0;
  const providers = given ?? (await defaultProviders());
  let imported = 0;

  for (const source of due) {
    try {
      const provider = providers[source.platform];
      if (!provider) throw new Error(`No ingestion provider for ${source.platform}.`);

      const isKnown = async (remoteId: string) =>
        Boolean(
          await prisma.feedImportedItem.findUnique({
            where: { feedSourceId_remoteId: { feedSourceId: source.id, remoteId } },
            select: { id: true },
          }),
        );
      // The account's whole history once — the importer used to read only
      // the newest page, so it had never seen most of it — and after that
      // back to the first page it already knows.
      const fullSync = !source.fullSyncedAt;
      const posts = provider.fetchPosts
        ? await provider.fetchPosts(source.actorUrl, fullSync ? {} : { isKnown })
        : await provider.fetchRecentPosts(source.actorUrl);

      // Oldest first, so the posts land in the order they were written.
      for (const post of [...posts].reverse()) {
        if (await isKnown(post.remoteId)) continue;

        const { title, body } = importedTitleAndBody(post.text);
        const slug = await uniqueSlug(source.creatorId, title);
        const product = await prisma.digitalProduct.create({
          data: {
            creatorId: source.creatorId,
            type: "POST",
            title: title.slice(0, 160),
            slug,
            status: "PUBLISHED",
            visibility: "PUBLIC",
            publishedAt: post.publishedAt,
            prices: { create: [{ currency: "USD", amountMinor: 0n, pricingType: "FREE" }] },
            post: { create: { content: body } },
          },
        });

        await prisma.feedImportedItem.create({
          data: { feedSourceId: source.id, remoteId: post.remoteId, productId: product.id },
        });
        imported += 1;
      }

      await prisma.feedSource.update({
        where: { id: source.id },
        data: { lastFetchedAt: new Date(), lastError: null, ...(fullSync ? { fullSyncedAt: new Date() } : {}) },
      });
    } catch (err) {
      await prisma.feedSource.update({
        where: { id: source.id },
        data: { lastFetchedAt: new Date(), lastError: err instanceof Error ? err.message : "Feed fetch failed." },
      });
    }
  }

  return imported;
}
