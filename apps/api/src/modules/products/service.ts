import { newPostAudience } from "../follows/service.js";
import { assertMayWriteWith } from "../rewards/service.js";
import { TelegramService } from "../telegram/service.js";
import { hasOwnText, postLength } from "@platform/shared";
import type { PrismaClient } from "@platform/db";
import { Money } from "@platform/shared";
import { Errors } from "../../lib/errors.js";
import { NotificationService } from "../notifications/service.js";
import { FederatedPostService } from "../federation/service.js";
import { ActivityPubService } from "../activitypub/service.js";
import { authorAutoPublishes } from "@platform/shared";
import { requireCreatorProfile, requireOwnedProduct, uniqueSlug } from "./product-helpers.js";
import type { CreatePostInput, UpdatePostInput } from "./schemas.js";
import { MIME_TO_EXT } from "../../lib/image-mime.js";
import { processImage } from "../../lib/image-resize.js";
import { storageService } from "../../lib/storage.js";
import { megabytes, SettingsService } from "../settings/service.js";

export class ProductService {
  private readonly notifications: NotificationService;
  private readonly federatedPosts: FederatedPostService;
  private readonly activityPub: ActivityPubService;

  constructor(private readonly prisma: PrismaClient) {
    this.notifications = new NotificationService(prisma);
    this.federatedPosts = new FederatedPostService(prisma);
    this.activityPub = new ActivityPubService(prisma);
  }

  /**
   * Queues a newly-published post for the fediverse when the author has
   * federation switched on and left auto-publish enabled.
   *
   * Deliberately best-effort: FederatedPostService.publish enforces the
   * public-and-free rule itself and throws for anything else, so a paid
   * or restricted post simply isn't federated — and neither that, nor an
   * empty instance allowlist, nor a missing actor key may turn publishing
   * a post on this platform into a failure. Delivery is a queued job
   * either way; nothing here talks to a remote server inline.
   */
  private async autoFederate(userId: string, creatorId: string, productId: string): Promise<void> {
    let settings;
    try {
      settings = await this.prisma.creatorFederationSettings.findUnique({ where: { creatorId } });
    } catch {
      return;
    }
    // No settings row means federated, with auto-publish on — see
    // `authorFederates`.
    if (!authorAutoPublishes(settings)) return;

    // Followers first, and on their own: they asked for these posts. This
    // used to run only after the instance-allowlist push, which throws
    // when the allowlist is empty — so a follower from Mastodon never got
    // a thing unless an administrator had also allowlisted their server.
    try {
      await this.activityPub.enqueuePostForFollowers(creatorId, productId);
    } catch {
      // Best-effort like everything here: publishing locally never fails
      // because the fediverse is unreachable.
    }

    try {
      await this.federatedPosts.publish(userId, productId);
    } catch {
      // Nothing to surface: an empty allowlist or a paid post is simply
      // not pushed to instances.
    }
  }

  /**
   * The server's limit on a post's length (Admin → Parameters). A post
   * already longer — written before the limit, or under a higher one —
   * may still be edited, as long as it does not grow.
   */
  /** A post must say something itself: files placed in it (`![[name]]`) are not words. */
  private checkOwnText(content: string) {
    if (!hasOwnText(content)) throw Errors.validation("A post needs some words of its own, not only files.");
  }

  private async checkLength(content: string, before?: string | null) {
    const max = await new SettingsService(this.prisma).postMaxChars();
    const length = postLength(content);
    if (length > max && length > (before ? postLength(before) : 0)) throw Errors.validation(`A post can be at most ${max} characters.`);
  }

  private async requireOwnGoal(creatorId: string, goalId: string) {
    const goal = await this.prisma.fundraisingGoal.findUnique({ where: { id: goalId }, select: { creatorId: true } });
    if (!goal || goal.creatorId !== creatorId) throw Errors.validation("That goal doesn't belong to you.");
  }

  async createPost(userId: string, input: CreatePostInput) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    this.checkOwnText(input.content);
    await this.checkLength(input.content);
    await assertMayWriteWith(this.prisma, input.content, userId);
    const slug = await uniqueSlug(this.prisma, profile.id, input.title);
    const money = Money.fromDecimalString(input.priceDecimal, input.currency);
    const pricingType = money.isZero() ? "FREE" : "ONE_TIME";

    if (input.visibility === "TIER") {
      const tier = await this.prisma.subscriptionTier.findUnique({ where: { id: input.requiredTierId } });
      if (!tier || tier.creatorId !== profile.id) {
        throw Errors.validation("That subscription tier doesn't belong to you.");
      }
    }
    if (input.visibility === "GOAL") await this.requireOwnGoal(profile.id, input.requiredGoalId!);

    return this.prisma.digitalProduct.create({
      data: {
        creatorId: profile.id,
        type: "POST",
        title: input.title,
        slug,
        description: input.description,
        coverUrl: input.coverUrl,
        visibility: input.visibility,
        requiredTierId: input.visibility === "TIER" ? input.requiredTierId : undefined,
        requiredGoalId: input.visibility === "GOAL" ? input.requiredGoalId : undefined,
        discountPercent: input.discountPercent ?? null,
        discountEndsAt: input.discountEndsAt ? new Date(input.discountEndsAt) : null,
        status: "DRAFT",
        prices: {
          create: [{ currency: input.currency, amountMinor: money.amountMinor, pricingType }],
        },
        post: { create: { content: input.content, excerpt: input.excerpt } },
      },
      include: { prices: true, post: true },
    });
  }

  /** Publish/unpublish are generic over every DigitalProduct type (spec rule #128). */
  async publish(userId: string, productId: string) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const product = await requireOwnedProduct(this.prisma, profile.id, productId);

    // A file product with no file is a listing for nothing. Publishing is
    // refused rather than allowed and half-broken at download time.
    if (product.type === "DIGITAL_FILE") {
      const file = await this.prisma.digitalFile.findUnique({ where: { productId } });
      if (!file) throw Errors.validation("Upload the file before publishing this product.");
    }

    const isFirstPublish = product.publishedAt === null;

    const published = await this.prisma.digitalProduct.update({
      where: { id: productId },
      data: { status: "PUBLISHED", publishedAt: product.publishedAt ?? new Date() },
    });

    // Notify subscribers once, the first time a post goes live — not on
    // every republish after an unpublish (spec: a free "keep up with new
    // posts" tier implies subscribers hear about it when something new
    // actually appears, not every status flip).
    if (isFirstPublish && product.type === "POST") {
      // Subscribers and followers, never the author (who may hold a tier
      // of their own from before subscribing to oneself was refused) —
      // in their notifications, and in Telegram for those who linked it.
      const audience = await newPostAudience(this.prisma, profile.id, userId);
      await this.notifications.notifyMany(audience, "NEW_POST", { productId, title: published.title });
      await new TelegramService(this.prisma).enqueue(productId, userId, audience).catch(() => 0);
    }

    // Reaching the fediverse is the default for a public free post, so
    // it happens on publish rather than behind a second manual button.
    if (product.type === "POST") {
      await this.autoFederate(userId, profile.id, productId);
    }

    return published;
  }

  async unpublish(userId: string, productId: string) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    await requireOwnedProduct(this.prisma, profile.id, productId);

    // A post taken down stops being pinned, so it does not hold a slot.
    return this.prisma.digitalProduct.update({
      where: { id: productId },
      data: { status: "ARCHIVED", featured: false, featuredPosition: null },
    });
  }

  /**
   * Editing a post after it exists. The slug is deliberately never
   * touched: it is the permalink, and rewriting it on a title change
   * would silently break every link already shared to the piece (the
   * UsernameHistory redirect covers renamed *authors*, not moved posts).
   *
   * Price lives on a separate ProductPrice row, so a price change
   * deactivates the current one and writes a new active row rather than
   * mutating history a purchase already points at.
   */
  async updatePost(userId: string, productId: string, input: UpdatePostInput) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    // Called for the ownership check it performs, not the row it returns.
    await requireOwnedProduct(this.prisma, profile.id, productId);
    if (input.content !== undefined) {
      const stored = await this.prisma.post.findUnique({ where: { productId }, select: { content: true } });
      this.checkOwnText(input.content);
      await this.checkLength(input.content, stored?.content);
      await assertMayWriteWith(this.prisma, input.content, userId);
    }

    // Whenever a tier is named — not only alongside a visibility change: a
    // post already at TIER visibility could otherwise be pointed at another
    // author's tier, and nobody subscribed here could read it.
    if (input.requiredTierId) {
      const tier = await this.prisma.subscriptionTier.findUnique({ where: { id: input.requiredTierId } });
      if (!tier || tier.creatorId !== profile.id) {
        throw Errors.validation("That subscription tier doesn't belong to you.");
      }
    }
    // The same for a goal, named on its own or with the move to GOAL; and
    // a move to GOAL must name one unless the post already waits on one.
    if (input.requiredGoalId) await this.requireOwnGoal(profile.id, input.requiredGoalId);
    if (input.visibility === "GOAL" && !input.requiredGoalId) {
      const current = await this.prisma.digitalProduct.findUnique({ where: { id: productId }, select: { requiredGoalId: true } });
      if (!current?.requiredGoalId) throw Errors.validation("Choose the goal that opens this post.");
    }

    const priceChanged = input.priceDecimal !== undefined;
    const currency = input.currency ?? "USD";
    const money = priceChanged ? Money.fromDecimalString(input.priceDecimal!, currency) : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (money) {
        await tx.productPrice.updateMany({ where: { productId, active: true }, data: { active: false } });
        await tx.productPrice.create({
          data: {
            productId,
            currency,
            amountMinor: money.amountMinor,
            pricingType: money.isZero() ? "FREE" : "ONE_TIME",
          },
        });
      }

      if (input.content !== undefined || input.excerpt !== undefined) {
        // A POST always has its Post row; upsert keeps this safe for a
        // product type that somehow does not.
        await tx.post.upsert({
          where: { productId },
          update: { content: input.content, excerpt: input.excerpt },
          create: { productId, content: input.content ?? "", excerpt: input.excerpt ?? null },
        });
      }

      return tx.digitalProduct.update({
        where: { id: productId },
        data: {
          title: input.title,
          description: input.description,
          coverUrl: input.coverUrl,
          visibility: input.visibility,
          // Clearing the tier alongside a move away from TIER visibility
          // keeps the two from disagreeing.
          requiredTierId:
            input.visibility !== undefined && input.visibility !== "TIER"
              ? null
              : input.requiredTierId ?? undefined,
          requiredGoalId:
            input.visibility !== undefined && input.visibility !== "GOAL"
              ? null
              : input.requiredGoalId ?? undefined,
          discountPercent: input.discountPercent,
          discountEndsAt: input.discountEndsAt === undefined ? undefined : input.discountEndsAt === null ? null : new Date(input.discountEndsAt),
        },
        include: { prices: { where: { active: true } }, post: true },
      });
    });

    // An edit of a post the fediverse already has reaches it only as an
    // Update. Best-effort, like publishing: saving never fails because a
    // remote server is unreachable.
    if (updated.status === "PUBLISHED") {
      await this.activityPub.enqueuePostUpdateForFollowers(profile.id, productId).catch(() => 0);
    }
    return updated;
  }

  /**
   * An author removing their own post. Soft delete, deliberately: every
   * listing and the entitlement check already filter on `deletedAt`, so
   * the post vanishes from the store, the author's page and search the
   * moment this runs — but a reader who *paid* for it keeps their
   * Purchase and Entitlement rows, and the payment history both sides
   * rely on stays auditable. A hard delete would cascade those away and
   * silently rewrite a buyer's records, which is not the author's to do.
   */
  /**
   * A post's cover: the picture a reader without access sees behind the
   * lock, Boosty-style — the teaser for what paying or subscribing opens.
   * Public by design, like an author's own cover, and served from the same
   * public `/covers/:key` route; the body stays gated as ever.
   */
  async uploadCover(userId: string, productId: string, file: { buffer: Buffer; mimeType: string }) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    await requireOwnedProduct(this.prisma, profile.id, productId);
    if (!MIME_TO_EXT[file.mimeType]) throw Errors.validation("A cover must be a PNG, JPEG, GIF, or WebP image.");
    const limit = await new SettingsService(this.prisma).maxUploadBytes(userId);
    if (file.buffer.byteLength > limit) {
      throw Errors.validation(`A cover must be ${megabytes(limit)} or smaller.`);
    }
    const processed = await processImage(file.buffer, file.mimeType, "cover");
    const key = await storageService.save(processed.buffer, processed.extension);
    const previous = (await this.prisma.digitalProduct.findUnique({ where: { id: productId }, select: { coverUrl: true } }))?.coverUrl;
    const updated = await this.prisma.digitalProduct.update({ where: { id: productId }, data: { coverUrl: `/covers/${key}` } });
    await this.discardStoredCover(previous);
    return updated;
  }

  async removeCover(userId: string, productId: string) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const product = await requireOwnedProduct(this.prisma, profile.id, productId);
    const updated = await this.prisma.digitalProduct.update({ where: { id: productId }, data: { coverUrl: null } });
    await this.discardStoredCover(product.coverUrl);
    return updated;
  }

  /**
   * A replaced or removed post cover is deleted from storage, so replacing
   * one over and over does not pile files up on the operator's disk. Only
   * a key this server stored for the post: a cover set as an outside URL
   * is not ours to delete, and a post cover key is never shared.
   */
  private async discardStoredCover(coverUrl: string | null | undefined) {
    const key = coverUrl?.match(/^\/covers\/([0-9a-f-]{36}\.(?:png|jpeg|gif|webp))$/)?.[1];
    if (!key) return;
    await storageService.delete(key).catch(() => {});
  }

  async remove(userId: string, productId: string) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    await requireOwnedProduct(this.prisma, profile.id, productId);

    return this.prisma.digitalProduct.update({
      where: { id: productId },
      data: { deletedAt: new Date(), status: "ARCHIVED", featured: false, featuredPosition: null },
    });
  }

  /**
   * One of the author's own posts, with the body — which `listMine`
   * deliberately omits so the dashboard listing does not carry every
   * post's full text. This is what the edit form loads.
   */
  async getMine(userId: string, productId: string) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const product = await this.prisma.digitalProduct.findUnique({
      where: { id: productId },
      include: { prices: { where: { active: true } }, post: true },
    });
    if (!product || product.creatorId !== profile.id || product.deletedAt) throw Errors.notFound("Product");
    return product;
  }

  async listMine(userId: string) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const products = await this.prisma.digitalProduct.findMany({
      where: { creatorId: profile.id, deletedAt: null },
      include: {
        prices: { where: { active: true } },
        // The dashboard's per-post editor needs the post's *current*
        // assignment to pre-select it — without this it always opened
        // empty, and saving from there silently wiped whatever was
        // already assigned (PUT replaces the full set).
        categories: { include: { category: { select: { id: true, name: true, slug: true } } } },
        tags: { include: { tag: { select: { id: true, name: true } } } },
        _count: {
          select: { comments: { where: { deletedAt: null } }, reactions: true, bookmarks: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return products.map((p) => ({
      ...p,
      categories: p.categories.map((c) => c.category),
      tags: p.tags.map((t) => t.tag),
      commentCount: p._count.comments,
      reactionCount: p._count.reactions,
      bookmarkCount: p._count.bookmarks,
    }));
  }

  async getByCreatorAndSlug(username: string, slug: string) {
    const product = await this.prisma.digitalProduct.findFirst({
      where: { slug, deletedAt: null, creator: { user: { username } } },
      include: { prices: { where: { active: true } }, post: { include: { attachments: true } }, creator: true },
    });
    if (!product) throw Errors.notFound("Product");
    return product;
  }
}
