import type { FastifyInstance } from "fastify";
import { EntitlementService } from "../entitlements/service.js";
import { FundraisingService } from "../fundraising/service.js";
import { ShortLinkService } from "../short-links/service.js";
import { BundleService } from "../bundles/service.js";
import { ReactionService } from "../reactions/service.js";
import { EngagementService } from "../engagement/service.js";
import { Errors } from "../../lib/errors.js";
import { resolveCurrentUsername } from "../../lib/username-history.js";
import { cardBody, cardPostSelect } from "../../lib/post-card.js";
import { reactionViewer } from "../../lib/reader-key.js";
import { isPostId } from "@platform/shared";

/** Posts per page of an author's listing, and the most a caller may ask for. */
const PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 60;

export default async function storeRoutes(app: FastifyInstance) {
  const entitlements = new EntitlementService(app.prisma);
  const fundraising = new FundraisingService(app.prisma);
  const shortLinks = new ShortLinkService(app.prisma);
  const bundles = new BundleService(app.prisma);
  const reactions = new ReactionService(app.prisma);
  const engagement = new EngagementService(app.prisma);

  app.get("/store/:username", async (request, reply) => {
    const requestedUsername = (request.params as { username: string }).username;
    const { category, tag, cursor, limit: rawLimit } = request.query as {
      category?: string;
      tag?: string;
      cursor?: string;
      limit?: string;
    };
    // A page at a time. An author with hundreds of posts used to send the
    // lot in one response, and the page then rendered a card — with its
    // own reaction row — for every one of them.
    const limit = Math.min(Math.max(Number(rawLimit) || PAGE_SIZE, 1), MAX_PAGE_SIZE);
    // Resolved through history so a link to an author's page from before
    // they renamed still lists their posts instead of 404ing.
    const username = await resolveCurrentUsername(app.prisma, requestedUsername);
    if (!username) throw Errors.notFound("Store");
    const creator = await app.prisma.creatorProfile.findFirst({ where: { user: { username } } });
    if (!creator) throw Errors.notFound("Store");

    const products = await app.prisma.digitalProduct.findMany({
      where: {
        creatorId: creator.id,
        status: "PUBLISHED",
        deletedAt: null,
        // Filters are applied in the query, not after: a filtered page
        // must not silently drop items past whatever limit a later slice
        // would have imposed.
        ...(category ? { categories: { some: { category: { slug: category, creatorId: creator.id } } } } : {}),
        ...(tag ? { tags: { some: { tag: { name: tag } } } } : {}),
      },
      include: {
        prices: { where: { active: true } },
        // The body and the attachments' metadata ride along so an
        // accessible post can show its opening lines and pictures in the
        // listing; both are dropped below for anyone the entitlement
        // check does not clear.
        post: { select: cardPostSelect },
        // What the lock should say: naming the tier beats "Free", which is
        // what an unpriced tier-gated post used to show.
        requiredTier: { select: { id: true, name: true } },
        requiredGoal: { select: { id: true, title: true } },
        // Counts drive the per-post engagement row in the feed. Deleted
        // comments are excluded so a moderated thread doesn't inflate it.
        _count: { select: { comments: { where: { deletedAt: null } }, reactions: true } },
        categories: { include: { category: { select: { id: true, name: true, slug: true } } } },
        tags: { include: { tag: { select: { id: true, name: true } } } },
      },
      // Pinned first, in the author's order; then newest first. `id` last,
      // so the order is total: two posts published in the same second must
      // not swap between pages and be served twice or not at all.
      orderBy: [
        { featured: "desc" },
        { featuredPosition: { sort: "asc", nulls: "last" } },
        { publishedAt: "desc" },
        { id: "desc" },
      ],
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    const hasMore = products.length > limit;
    if (hasMore) products.pop();

    // Batched, so the feed can render a full reaction row per card
    // without opening each post — two queries for the whole listing.
    const reactionSummaries = await reactions.summariesFor(
      products.map((p) => p.id),
      reactionViewer(request),
    );

    // One batched decision for the page: which of these may this reader
    // actually read. A listing used to call every gated post "locked" by
    // visibility alone, so a subscriber — and the author themselves — saw
    // a lock on posts they could open.
    const allowed = await entitlements.allowedProductIds(
      request.currentUser?.id ?? null,
      products.map((p) => ({
        id: p.id,
        creatorId: p.creatorId,
        creatorUserId: creator.userId,
        status: p.status,
        visibility: p.visibility,
        requiredTierId: p.requiredTierId,
        requiredGoalId: p.requiredGoalId,
      })),
    );

    const bookmarks = await engagement.bookmarkedAmong(
      request.currentUser?.id ?? null,
      products.map((p) => p.id),
    );

    const payload = {
      // Lets a caller that reached this via an old username notice the
      // rename and update its own address bar, the same as the post
      // detail route below.
      creatorUsername: username,
      // Null when this was the last page.
      nextCursor: hasMore ? (products[products.length - 1]?.id ?? null) : null,
      products: products.map((p) => ({
        id: p.id,
        type: p.type,
        title: p.title,
        slug: p.slug,
        description: p.description,
        coverUrl: p.coverUrl,
        visibility: p.visibility,
        requiredTier: p.requiredTier,
        requiredGoal: p.requiredGoal,
        discountPercent: p.discountPercent,
        discountEndsAt: p.discountEndsAt,
        pinned: p.featured,
        canAccess: allowed.has(p.id),
        // The excerpt and the pictures are withheld exactly like the full
        // body is: not sent, rather than sent and hidden by the page.
        ...cardBody(p.id, p.post, allowed.has(p.id)),
        bookmarked: bookmarks.has(p.id),
        prices: p.prices,
        publishedAt: p.publishedAt,
        // Seen in a listing or opened — see feed/service.ts.
        viewCount: p.viewCount + p.impressionCount,
        commentCount: p._count.comments,
        reactionCount: p._count.reactions,
        reactions: reactionSummaries[p.id] ?? { counts: [], mine: [] },
        categories: p.categories.map((c) => c.category),
        tags: p.tags.map((t) => t.tag),
      })),
    };
    // In each card's opening lines, @[text](url) is this reader's own short link.
    const excerpts = await shortLinks.personalize(
      payload.products.map((p) => ({ productId: p.id, ownerId: creator.userId, text: p.excerpt ?? null })),
      request.currentUser?.id ?? null,
    );
    payload.products.forEach((p, n) => {
      p.excerpt = excerpts[n] ?? null;
    });
    reply.send(payload);
  });

  app.get("/store/:username/:slug", async (request, reply) => {
    const { slug } = request.params as { username: string; slug: string };
    const requestedUsername = (request.params as { username: string }).username;
    // A post permalink is the other link an author's supporters actually
    // bookmark and share — it needs the same history fallback the profile
    // gets, or every shared post link breaks the moment its author renames.
    const username = await resolveCurrentUsername(app.prisma, requestedUsername);
    if (!username) throw Errors.notFound("Product");
    const product = await app.prisma.digitalProduct.findFirst({
      // Either the post's id — its address today, `/<author>/posts/<id>` —
      // or the slug its links carried before.
      where: { ...(isPostId(slug) ? { id: slug } : { slug }), deletedAt: null, creator: { user: { username } } },
      include: {
        prices: { where: { active: true } },
        post: { include: { attachments: true } },
        creator: { select: { userId: true } },
        stickerPack: { include: { stickers: { orderBy: { position: "asc" } } } },
        digitalFile: true,
        requiredTier: { select: { id: true, name: true } },
        _count: { select: { comments: { where: { deletedAt: null } } } },
        categories: { include: { category: { select: { id: true, name: true, slug: true } } } },
        tags: { include: { tag: { select: { id: true, name: true } } } },
      },
    });
    if (!product) throw Errors.notFound("Product");

    const decision = await entitlements.canAccessProduct(request.currentUser?.id ?? null, product.id);
    // A DRAFT/ARCHIVED/DISABLED product is invisible to anyone but its
    // owner — the whole response 404s rather than just gating its content,
    // so a guessed slug can't confirm a draft's title/price/existence, and
    // a moderation-disabled product disappears from the public entirely
    // rather than just losing its content.
    if (decision.reason === "PRODUCT_NOT_FOUND" || decision.reason === "PRODUCT_DISABLED") {
      throw Errors.notFound("Product");
    }

    // A simple real view counter (spec rule #125) — never counts the
    // owner previewing their own product. The incremented value is read
    // back off the update so the response carries this view, rather than
    // the stale count fetched a moment earlier.
    let viewCount = product.viewCount;
    if (decision.reason !== "OWNER") {
      const updated = await app.prisma.digitalProduct.update({
        where: { id: product.id },
        data: { viewCount: { increment: 1 } },
        select: { viewCount: true },
      });
      viewCount = updated.viewCount;
    }

    const bundle = product.type === "BUNDLE" ? await bundles.getDetail(product.id, request.currentUser?.id ?? null) : null;

    // Reactions and the caller's own bookmark state ride along with the
    // post rather than costing two more round-trips — both are cheap,
    // and both are needed to render the action bar in its final state
    // instead of flashing an empty one first.
    const viewerId = request.currentUser?.id ?? null;
    const [reactionSummary, bookmarked] = await Promise.all([
      reactions.summary(product.id, reactionViewer(request)),
      engagement.isBookmarked(viewerId, product.id),
    ]);

    reply.send({
      // Same rename-detection contract as GET /store/:username above: if
      // this differs from the username in the request URL, the caller
      // reached this post through an old link and should update its own.
      creatorUsername: username,
      product: {
        id: product.id,
        type: product.type,
        title: product.title,
        slug: product.slug,
        description: product.description,
        coverUrl: product.coverUrl,
        visibility: product.visibility,
        requiredTier: product.requiredTier,
        // The goal a GOAL post waits on, with how far along it is.
        requiredGoal: product.visibility === "GOAL" && product.requiredGoalId ? await fundraising.progressOf(product.requiredGoalId) : null,
        prices: product.prices,
        discountPercent: product.discountPercent,
        discountEndsAt: product.discountEndsAt,
        publishedAt: product.publishedAt,
        pinned: product.featured,
        viewCount: viewCount + product.impressionCount,
        commentCount: product._count.comments,
        categories: product.categories.map((c) => c.category),
        tags: product.tags.map((t) => t.tag),
      },
      access: decision,
      reactions: reactionSummary,
      bookmarked,
      // Content is only ever attached when the backend has already decided
      // the requester is entitled — the frontend never sees it otherwise
      // (spec rules #63, #133). Bundle contents are marketing metadata
      // (titles/covers), not gated content, so they're always attached —
      // per-item `owned` still reflects real entitlements.
      // Each @[text](url) becomes this reader's own short link.
      content: decision.allowed
        ? (await shortLinks.personalize([{ productId: product.id, ownerId: product.creator.userId, text: product.post?.content ?? null }], viewerId))[0] ?? null
        : null,
      // `storageKey` never leaves the server — the frontend only ever gets
      // a URL to the gated download route, which re-checks entitlement
      // itself on every request rather than trusting this one decision.
      attachments: decision.allowed
        ? (product.post?.attachments ?? [])
            .sort((a, b) => a.position - b.position)
            .map((a) => ({
              id: a.id,
              kind: a.kind,
              mimeType: a.mimeType,
              sizeBytes: a.sizeBytes,
              originalFilename: a.originalFilename,
              altText: a.altText,
              url: `/products/${product.id}/attachments/${a.id}/file`,
            }))
        : [],
      bundle,
      // Sticker files are treated the same as any other gated content:
      // no URL crosses the wire until EntitlementService has said yes
      // (spec rules #34, #63).
      stickers: decision.allowed ? product.stickerPack?.stickers ?? [] : [],
      // Name and size are marketing copy — a buyer needs to know what they
      // are paying for. The download URL only appears once they may have it,
      // and the route re-checks entitlement anyway.
      file: product.digitalFile
        ? {
            originalFilename: product.digitalFile.originalFilename,
            mimeType: product.digitalFile.mimeType,
            sizeBytes: product.digitalFile.sizeBytes.toString(),
            checksumSha256: product.digitalFile.checksumSha256,
            url: decision.allowed ? `/products/${product.id}/file` : null,
          }
        : null,
    });
  });
}
