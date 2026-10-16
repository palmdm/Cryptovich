import type { PrismaClient, Prisma } from "@platform/db";
import type { AccessDecision, EntitlementSourceType } from "@platform/shared";
import { FundraisingService } from "../fundraising/service.js";

type Client = PrismaClient | Prisma.TransactionClient;

/** What `allowedProductIds` needs to know about each product in a listing. */
export interface AccessProbe {
  id: string;
  creatorId: string;
  creatorUserId: string;
  status: string;
  visibility: "PUBLIC" | "SUBSCRIBERS" | "TIER" | "PURCHASED" | "PRIVATE" | "GOAL";
  requiredTierId: string | null;
  requiredGoalId: string | null;
}

/**
 * The single authority for "can this user access this product". Nothing
 * else — not the frontend, not a product-type-specific endpoint — is
 * permitted to make this decision (spec rules #13, #61, #133).
 */
export class EntitlementService {
  constructor(private readonly prisma: PrismaClient) {}

  async canAccessProduct(userId: string | null, productId: string): Promise<AccessDecision> {
    const product = await this.prisma.digitalProduct.findUnique({
      where: { id: productId },
      include: { creator: true },
    });

    if (!product || product.deletedAt) return { allowed: false, reason: "PRODUCT_NOT_FOUND" };

    const isOwner = userId !== null && product.creator.userId === userId;

    if (product.status !== "PUBLISHED" && !isOwner) {
      return { allowed: false, reason: product.status === "DISABLED" ? "PRODUCT_DISABLED" : "PRODUCT_NOT_FOUND" };
    }

    if (isOwner) return { allowed: true, reason: "OWNER" };

    if (product.visibility === "PUBLIC") return { allowed: true, reason: "PUBLIC" };

    // Closed to everyone but the author until the goal is met — no
    // subscription, purchase or grant opens it early — and then open to
    // everyone, signed in or not. A post whose goal is gone fails closed.
    if (product.visibility === "GOAL") {
      const goalId = product.requiredGoalId;
      if (goalId && (await new FundraisingService(this.prisma).reachedGoalIds([goalId])).has(goalId)) {
        return { allowed: true, reason: "GOAL_REACHED" };
      }
      return { allowed: false, reason: "NOT_ENTITLED" };
    }

    if (!userId) return { allowed: false, reason: "NOT_ENTITLED" };

    // Subscription-gated visibility is checked live against Subscription,
    // not backfilled into Entitlement rows per product — a creator's
    // catalog can grow under a tier without a migration job re-granting
    // access to every existing subscriber (spec rule #46).
    //
    // TIER must fail CLOSED if the product was never actually assigned a
    // tier: falling back to "any active subscriber of this creator" would
    // silently turn a tier-gated product into a subscribers-only one,
    // granting access to subscribers on a cheaper tier than intended.
    if (product.visibility === "TIER" && !product.requiredTierId) {
      return { allowed: false, reason: "NOT_ENTITLED" };
    }

    if (product.visibility === "SUBSCRIBERS" || product.visibility === "TIER") {
      const hasActiveSubscription = await this.prisma.subscription.findFirst({
        where: {
          userId,
          status: "ACTIVE",
          expiresAt: { gt: new Date() },
          tierId: product.visibility === "TIER" ? product.requiredTierId! : undefined,
          tier: { creatorId: product.creatorId },
        },
      });
      if (hasActiveSubscription) return { allowed: true, reason: "SUBSCRIBED" };
      if (product.visibility === "SUBSCRIBERS") return { allowed: false, reason: "NOT_ENTITLED" };
      // TIER visibility also accepts a direct MANUAL_GRANT/PRODUCT_PURCHASE
      // entitlement below, so fall through instead of returning here.
    }

    const entitlement = await this.prisma.entitlement.findFirst({
      where: {
        userId,
        productId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: "desc" },
    });

    if (!entitlement) return { allowed: false, reason: "NOT_ENTITLED" };

    const reason = entitlement.sourceType === "SUBSCRIPTION" ? "SUBSCRIBED" : entitlement.sourceType === "MANUAL_GRANT" ? "MANUAL_GRANT" : "PURCHASED";
    return { allowed: true, reason };
  }

  /**
   * The same decision as `canAccessProduct`, for a whole listing at once:
   * a feed card has to know whether to show the post or the lock, and
   * asking per product would run two queries per card.
   *
   * Kept deliberately in step with `canAccessProduct` above — same rules,
   * same order, including TIER failing closed when no tier was ever
   * assigned. It answers only "allowed", never *why*, and is for listings:
   * anything that actually serves gated content still goes through
   * `canAccessProduct` (spec rules #13, #61, #133).
   */
  async allowedProductIds(userId: string | null, products: AccessProbe[]): Promise<Set<string>> {
    const allowed = new Set<string>();
    const undecided: AccessProbe[] = [];
    const waitingOnGoal: AccessProbe[] = [];

    for (const product of products) {
      const isOwner = userId !== null && product.creatorUserId === userId;
      if (product.status !== "PUBLISHED" && !isOwner) continue;
      if (isOwner || product.visibility === "PUBLIC") {
        allowed.add(product.id);
        continue;
      }
      // GOAL: the goal alone decides, for every reader alike.
      if (product.visibility === "GOAL") {
        if (product.requiredGoalId) waitingOnGoal.push(product);
        continue;
      }
      // TIER with no tier assigned fails closed, as it does above.
      if (product.visibility === "TIER" && !product.requiredTierId) continue;
      if (userId) undecided.push(product);
    }

    if (waitingOnGoal.length > 0) {
      const reached = await new FundraisingService(this.prisma).reachedGoalIds(waitingOnGoal.map((p) => p.requiredGoalId!));
      for (const product of waitingOnGoal) if (reached.has(product.requiredGoalId!)) allowed.add(product.id);
    }

    if (!userId || undecided.length === 0) return allowed;

    const now = new Date();
    const [subscriptions, entitlements] = await Promise.all([
      this.prisma.subscription.findMany({
        where: { userId, status: "ACTIVE", expiresAt: { gt: now } },
        select: { tierId: true, tier: { select: { creatorId: true } } },
      }),
      this.prisma.entitlement.findMany({
        where: {
          userId,
          productId: { in: undecided.map((p) => p.id) },
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { productId: true },
      }),
    ]);

    const subscribedCreators = new Set(subscriptions.map((s) => s.tier.creatorId));
    const subscribedTiers = new Set(subscriptions.map((s) => s.tierId));
    const entitled = new Set(entitlements.map((e) => e.productId));

    for (const product of undecided) {
      if (product.visibility === "SUBSCRIBERS" && subscribedCreators.has(product.creatorId)) {
        allowed.add(product.id);
        continue;
      }
      if (product.visibility === "TIER" && subscribedTiers.has(product.requiredTierId!)) {
        allowed.add(product.id);
        continue;
      }
      // PURCHASED, and TIER via a direct grant or purchase.
      if (product.visibility !== "SUBSCRIBERS" && entitled.has(product.id)) allowed.add(product.id);
    }

    return allowed;
  }

  /**
   * Accepts an optional transaction client so a caller already inside a
   * `$transaction` (e.g. `PaymentService.completePurchase`) can grant
   * entitlements atomically with the purchase/payment writes, instead of
   * this running on a separate connection outside that transaction.
   */
  async grant(
    params: {
      userId: string;
      productId: string;
      sourceType: EntitlementSourceType;
      sourceId: string;
      expiresAt?: Date | null;
    },
    client: Client = this.prisma,
  ) {
    return client.entitlement.upsert({
      where: {
        userId_productId_sourceType_sourceId: {
          userId: params.userId,
          productId: params.productId,
          sourceType: params.sourceType,
          sourceId: params.sourceId,
        },
      },
      update: { revokedAt: null, expiresAt: params.expiresAt ?? null },
      create: {
        userId: params.userId,
        productId: params.productId,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        expiresAt: params.expiresAt ?? null,
      },
    });
  }

  /**
   * Grants entitlements for a bundle purchase: the bundle itself plus every
   * member product, without duplicating entitlements the user already holds
   * from another source (spec rule #18). This is the ONLY place bundle
   * entitlement fanout is implemented — callers (including
   * `PaymentService.completePurchase`) must go through it rather than
   * reimplementing the loop themselves.
   */
  async grantBundlePurchase(
    params: { userId: string; bundleProductId: string; purchaseId: string },
    client: Client = this.prisma,
  ) {
    const items = await client.productItem.findMany({
      where: { productId: params.bundleProductId },
      select: { itemProductId: true },
    });

    await this.grant(
      {
        userId: params.userId,
        productId: params.bundleProductId,
        sourceType: "BUNDLE_PURCHASE",
        sourceId: params.purchaseId,
      },
      client,
    );

    for (const item of items) {
      await this.grant(
        {
          userId: params.userId,
          productId: item.itemProductId,
          sourceType: "BUNDLE_PURCHASE",
          sourceId: params.purchaseId,
        },
        client,
      );
    }
  }

  /**
   * A product can legitimately be entitled through more than one source at
   * once (bought directly, then again as part of a bundle) — each grant is
   * kept as its own row so revoking one source (e.g. refunding the bundle)
   * doesn't clobber another's access. The library view only needs one row
   * per product though, so this dedupes by productId, keeping the earliest
   * grant (spec rule #18 — owning 3 of 12 items then buying the bundle
   * results in owning 12 products, not 12+3 library entries).
   */
  async listOwned(userId: string) {
    const entitlements = await this.prisma.entitlement.findMany({
      where: { userId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      include: { product: true },
      orderBy: { createdAt: "asc" },
    });
    const seen = new Set<string>();
    const deduped = [];
    for (const entitlement of entitlements) {
      if (!entitlement.product || entitlement.product.deletedAt) continue;
      if (seen.has(entitlement.productId!)) continue;
      seen.add(entitlement.productId!);
      deduped.push(entitlement);
    }
    return deduped.reverse();
  }
}
