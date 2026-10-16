import { randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "@platform/db";
import { Money, salePrice, type Currency } from "@platform/shared";
import { Errors } from "../../lib/errors.js";
import { withScopeLock } from "../../lib/scope-lock.js";
import { EntitlementService } from "../entitlements/service.js";
import { NotificationService } from "../notifications/service.js";
import { RewardService } from "../rewards/service.js";

const PAYMENT_TTL_MS = 15 * 60 * 1000;
const FAR_FUTURE = new Date("2999-01-01T00:00:00Z");

/**
 * An author can be paid if they have published either written
 * instructions or at least one wallet address. Checkout refuses before
 * that, because otherwise the payer is shown a payment they have no way
 * to make.
 */
export async function assertPayable(
  client: PrismaClient | Prisma.TransactionClient,
  creator: { id: string; userId: string; manualPaymentInstructions: string | null },
): Promise<void> {
  if (creator.manualPaymentInstructions) return;
  const wallets = await client.wallet.count({ where: { userId: creator.userId } });
  if (wallets === 0) {
    throw Errors.notPayable();
  }
}

export class PaymentService {
  private readonly entitlements: EntitlementService;
  private readonly notifications: NotificationService;
  private readonly rewards: RewardService;

  constructor(private readonly prisma: PrismaClient) {
    this.entitlements = new EntitlementService(prisma);
    this.notifications = new NotificationService(prisma);
    this.rewards = new RewardService(prisma);
  }

  /**
   * Notifies the tier's creator ("new subscriber" vs "renewal") and sends
   * the subscriber a welcome message (the creator's own text, or a generic
   * default — see `NotificationService.welcomePayload`). Shared by every
   * path that activates a subscription: the free-tier and
   * discounted-to-zero fast paths below, and `completePurchase` once a paid
   * subscription's payment confirms. "Renewal" means this user has held
   * *any* prior subscription row for this exact tier before — active,
   * expired, or cancelled.
   */
  private async notifySubscriptionActivated(tx: Prisma.TransactionClient, subscription: { id: string; userId: string; tierId: string }, isRenewal: boolean) {
    const tier = await tx.subscriptionTier.findUnique({
      where: { id: subscription.tierId },
      include: { creator: { include: { user: { select: { username: true } } } } },
    });
    if (!tier) return;

    await tx.notification.create({
      data: { userId: tier.creator.userId, type: isRenewal ? "SUBSCRIPTION_RENEWED" : "NEW_SUBSCRIBER", payload: { subscriptionId: subscription.id } },
    });
    await tx.notification.create({
      data: {
        userId: subscription.userId,
        type: "WELCOME_MESSAGE",
        payload: {
          ...this.notifications.welcomePayload(isRenewal ? "RENEWAL" : "NEW_SUBSCRIBER", tier.creator),
          creatorUsername: tier.creator.user.username,
        },
      },
    });
  }

  /**
   * Starts (or resumes) checkout for a one-time product purchase. Reuses an
   * existing, still-valid pending payment for the same user+product instead
   * of creating a duplicate, so one payment can never spawn two purchases
   * (spec rule #55).
   *
   * Every payment is settled by the author confirming receipt themselves
   * via `confirm()` — the payer sends money by whatever route the author
   * published (bank transfer, PayPal, a wallet address), marks it sent,
   * and the author confirms. Nothing here auto-confirms, and the platform
   * never custodies funds.
   */
  async startProductCheckout(userId: string, productId: string) {
    const product = await this.prisma.digitalProduct.findUnique({
      where: { id: productId },
      include: { prices: { where: { active: true } }, creator: true },
    });
    if (!product || product.status !== "PUBLISHED") throw Errors.notFound("Product");

    const price = product.prices[0];
    if (!price || price.pricingType === "FREE") {
      throw Errors.validation("This product is free — no checkout is needed.");
    }

    await assertPayable(this.prisma, product.creator);

    return withScopeLock(this.prisma, `checkout:product:${userId}:${productId}`, async (tx) => {
      const existingPurchase = await tx.purchase.findFirst({
        where: { userId, productId, status: "PENDING" },
        include: { payment: true },
      });
      if (existingPurchase?.payment && existingPurchase.payment.status !== "EXPIRED" && existingPurchase.payment.expiresAt && existingPurchase.payment.expiresAt > new Date()) {
        return {
          payment: existingPurchase.payment,
          purchase: existingPurchase,
          manualInstructions: product.creator.manualPaymentInstructions,
        };
      }

      const idempotencyKey = randomUUID();
      // The author's sale, if one is on: worked out here, never taken from the page.
      const amountMinor = salePrice(price.amountMinor, product);

      const payment = await tx.payment.create({
        data: {
          userId,
          purpose: product.type === "BUNDLE" ? "BUNDLE_PURCHASE" : "PRODUCT_PURCHASE",
          amountMinor,
          currency: price.currency,
          status: "AWAITING_PAYMENT",
          idempotencyKey,
          expiresAt: new Date(Date.now() + PAYMENT_TTL_MS),
        },
      });

      const purchase = await tx.purchase.create({
        data: {
          userId,
          productId,
          priceId: price.id,
          amountMinor,
          currency: price.currency,
          paymentId: payment.id,
          status: "PENDING",
        },
      });

      return { payment, purchase, manualInstructions: product.creator.manualPaymentInstructions };
    });
  }

  /**
   * Donations are a separate financial object from purchases (spec rule
   * #42) — no product, no entitlement, just a payment that credits a
   * creator. Confirmation reuses the exact same settlement path as a
   * product purchase (`applyPaymentState` -> `completePurchase`).
   *
   * `userId` is nullable — a donation can be sent without registration;
   * the returned `payment.id` doubles as an unguessable capability token
   * the anonymous payer uses to check status (see `getStatus`).
   */
  async startDonationCheckout(
    userId: string | null,
    input: { creatorUsername: string; amountDecimal: string; currency: Currency; message?: string; isPublic: boolean; rewardId?: string },
  ) {
    const creator = await this.prisma.creatorProfile.findFirst({ where: { user: { username: input.creatorUsername } } });
    if (!creator) throw Errors.notFound("Creator");

    const money = Money.fromDecimalString(input.amountDecimal, input.currency);
    if (money.isZero()) throw Errors.validation("Enter an amount greater than zero.");

    await assertPayable(this.prisma, creator);
    // A reward rides on the same payment: the tip plus its price, one
    // transfer, settled by the one confirmation.
    const rewardMinor = input.rewardId ? await this.rewards.priceToAttach(input.rewardId, input.currency) : 0n;

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          userId,
          purpose: "DONATION",
          amountMinor: money.amountMinor + rewardMinor,
          currency: input.currency,
          status: "AWAITING_PAYMENT",
          idempotencyKey: randomUUID(),
          expiresAt: new Date(Date.now() + PAYMENT_TTL_MS),
        },
      });

      const donation = await tx.donation.create({
        data: {
          creatorId: creator.id,
          senderUserId: userId,
          amountMinor: money.amountMinor,
          currency: input.currency,
          message: input.message,
          isPublic: input.isPublic,
          paymentId: payment.id,
          status: "PENDING",
        },
      });

      if (input.rewardId) {
        await this.rewards.attachToPayment(tx, {
          rewardId: input.rewardId,
          creatorId: creator.id,
          senderUserId: userId,
          paymentId: payment.id,
          currency: input.currency,
        });
      }

      return { payment, donation, manualInstructions: creator.manualPaymentInstructions };
    });
  }

  /**
   * Subscriptions get their own PENDING row up front (mirroring
   * Purchase/Donation) so `Subscription.paymentId` can enforce the same
   * schema-level idempotency guarantee: one payment can never activate two
   * subscription rows (spec rule #55). `startedAt`/`expiresAt` are
   * finalized on confirmation, not here, so an abandoned-then-retried
   * checkout doesn't shortchange the paid period.
   *
   * A FREE tier (price 0 — "follow, no payment") activates instantly with
   * no Payment row at all. A `discountCode` is validated and applied
   * server-side; the client never gets to say what the discounted price is.
   */
  async startSubscriptionCheckout(userId: string, tierId: string, options: { discountCode?: string; rewardId?: string } = {}) {
    const tier = await this.prisma.subscriptionTier.findUnique({ where: { id: tierId }, include: { creator: true } });
    if (!tier || tier.status !== "ACTIVE") throw Errors.notFound("Subscription tier");
    if (tier.creator.userId === userId) throw Errors.validation("You cannot subscribe to your own page.");
    const rewardMinor = options.rewardId ? await this.rewards.priceToAttach(options.rewardId, tier.currency) : 0n;

    return withScopeLock(this.prisma, `checkout:subscription:${userId}:${tierId}`, async (tx) => {
      const existingActive = await tx.subscription.findFirst({
        where: { userId, tierId, status: { in: ["ACTIVE", "PENDING"] } },
      });
      if (existingActive) throw Errors.validation("You already have an active or pending subscription to this tier.");

      const periodMs = tier.period === "YEAR" ? 365 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;

      // A reward needs a payment to ride on; a subscription with nothing
      // to pay has none, so the reward is sent on its own instead.
      const refuseFreeWithReward = () => {
        if (rewardMinor > 0n) throw Errors.validation("This subscription is free — send the reward on its own.");
      };

      // Free follow-only tier: no payment at all — just
      // grant access immediately.
      if (tier.amountMinor === 0n) {
        refuseFreeWithReward();
        const isRenewal = (await tx.subscription.count({ where: { userId, tierId } })) > 0;
        const subscription = await tx.subscription.create({
          data: { userId, tierId, status: "ACTIVE", startedAt: new Date(), expiresAt: FAR_FUTURE },
        });
        await this.notifySubscriptionActivated(tx, subscription, isRenewal);
        return { payment: null, subscription, manualInstructions: null };
      }

      await assertPayable(tx, tier.creator);

      // The author's sale first; a discount code then comes off that.
      const listMinor = salePrice(tier.amountMinor, tier);
      let amountMinor = listMinor;
      let discountCodeId: string | null = null;
      if (options.discountCode) {
        const code = await tx.discountCode.findUnique({ where: { creatorId_code: { creatorId: tier.creatorId, code: options.discountCode } } });
        if (!code || !code.active || (code.expiresAt && code.expiresAt < new Date())) {
          throw Errors.validation("That discount code isn't valid.");
        }
        // Atomic compare-and-swap on redemption count: the WHERE clause is
        // re-evaluated against the current row by Postgres, so two
        // concurrent redemptions of the same code can't both succeed past
        // its limit even without an explicit lock.
        const claimed = await tx.discountCode.updateMany({
          where: {
            id: code.id,
            active: true,
            ...(code.maxRedemptions !== null ? { redeemedCount: { lt: code.maxRedemptions } } : {}),
          },
          data: { redeemedCount: { increment: 1 } },
        });
        if (claimed.count === 0) throw Errors.validation("That discount code has reached its redemption limit.");

        const discounted =
          code.type === "PERCENT_OFF"
            ? (listMinor * BigInt(100 - Math.min(100, Math.max(0, code.value)))) / 100n
            : listMinor - BigInt(code.value);
        amountMinor = discounted < 0n ? 0n : discounted;
        discountCodeId = code.id;
      }

      // A code that discounts a tier all the way to zero still creates a
      // real Payment/Subscription pair (unlike the FREE-tier fast path
      // above) so the discount's use is recorded and auditable — it just
      // completes with nothing owed.
      if (amountMinor === 0n) {
        refuseFreeWithReward();
        const isRenewal = (await tx.subscription.count({ where: { userId, tierId } })) > 0;
        const subscription = await tx.subscription.create({
          data: { userId, tierId, status: "ACTIVE", startedAt: new Date(), expiresAt: new Date(Date.now() + periodMs), discountCodeId },
        });
        await this.notifySubscriptionActivated(tx, subscription, isRenewal);
        return { payment: null, subscription, manualInstructions: null };
      }

      const idempotencyKey = randomUUID();

      const payment = await tx.payment.create({
        data: {
          userId,
          purpose: "SUBSCRIPTION",
          amountMinor: amountMinor + rewardMinor,
          currency: tier.currency,
          status: "AWAITING_PAYMENT",
          idempotencyKey,
          expiresAt: new Date(Date.now() + PAYMENT_TTL_MS),
        },
      });

      const subscription = await tx.subscription.create({
        data: {
          userId,
          tierId,
          status: "PENDING",
          paymentId: payment.id,
          discountCodeId,
          expiresAt: new Date(Date.now() + periodMs),
        },
      });

      if (options.rewardId) {
        await this.rewards.attachToPayment(tx, {
          rewardId: options.rewardId,
          creatorId: tier.creatorId,
          senderUserId: userId,
          paymentId: payment.id,
          currency: tier.currency,
        });
      }

      return { payment, subscription, manualInstructions: tier.creator.manualPaymentInstructions };
    });
  }

  /**
   * Anonymous-donation-safe: if the payment has no owning user (a
   * no-registration donation), anyone who knows the exact payment id can
   * read its status — the UUID itself is the capability token, the same
   * pattern Stripe's client secrets use. Otherwise, only the owning user.
   */
  async getStatus(userId: string | null, paymentId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw Errors.notFound("Payment");
    if (payment.userId !== null && payment.userId !== userId) throw Errors.notFound("Payment");
    return payment;
  }

  /** Informational only (spec: payer clicks "I've sent it") — never treated as authoritative. */
  async markAsPaid(paymentId: string, actingUserId: string | null) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    // Someone else's payment answers like one that does not exist. Without
    // this anyone holding an id could mark it, and every call notified the
    // author again.
    if (!payment || (payment.userId && payment.userId !== actingUserId)) throw Errors.notFound("Payment");
    if (payment.status !== "AWAITING_PAYMENT") throw Errors.validation("This payment can no longer be marked as paid.");
    // Once is the whole message: a second press tells the author nothing new.
    if (payment.payerMarkedPaidAt) return payment;

    const updated = await this.prisma.payment.update({ where: { id: paymentId }, data: { payerMarkedPaidAt: new Date() } });

    const recipientUserId = await this.resolveRecipientUserId(this.prisma, payment);
    if (recipientUserId) {
      await this.prisma.notification.create({
        data: { userId: recipientUserId, type: "PAYMENT_MARKED_PAID", payload: { paymentId } },
      });
    }
    return updated;
  }

  /**
   * The recipient (product's author / donation's author / tier's author)
   * confirming receipt themselves. This is the only route to a settled
   * payment: there is deliberately no self-serve "confirm my own payment"
   * endpoint for the payer (spec: "worthwhile for the author to confirm
   * in their personal account that the payment has been completed").
   */
  async confirm(actingUserId: string, paymentId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw Errors.notFound("Payment");
    const recipientUserId = await this.resolveRecipientUserId(this.prisma, payment);
    if (!recipientUserId || recipientUserId !== actingUserId) throw Errors.forbidden();

    return this.applyPaymentState(paymentId, { status: "CONFIRMED" });
  }

  async reject(actingUserId: string, paymentId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw Errors.notFound("Payment");
    const recipientUserId = await this.resolveRecipientUserId(this.prisma, payment);
    if (!recipientUserId || recipientUserId !== actingUserId) throw Errors.forbidden();

    return this.applyPaymentState(paymentId, { status: "FAILED" });
  }

  private async resolveRecipientUserId(client: PrismaClient | Prisma.TransactionClient, payment: { id: string; purpose: string }): Promise<string | null> {
    if (payment.purpose === "DONATION") {
      const donation = await client.donation.findUnique({ where: { paymentId: payment.id }, include: { creator: true } });
      return donation?.creator.userId ?? null;
    }
    if (payment.purpose === "SUBSCRIPTION") {
      const subscription = await client.subscription.findUnique({ where: { paymentId: payment.id }, include: { tier: { include: { creator: true } } } });
      return subscription?.tier.creator.userId ?? null;
    }
    if (payment.purpose === "REWARD") {
      const gift = await client.rewardGift.findFirst({ where: { paymentId: payment.id }, include: { creator: true } });
      return gift?.creator.userId ?? null;
    }
    // PRODUCT_PURCHASE / BUNDLE_PURCHASE
    const purchase = await client.purchase.findUnique({ where: { paymentId: payment.id }, include: { product: { include: { creator: true } } } });
    return purchase?.product.creator.userId ?? null;
  }

  /**
   * Everything awaiting this creator's attention — the "pending
   * confirmations" dashboard. Payment doesn't carry a creatorId directly
   * (it's shared across three different purchase kinds), so this unions the
   * three owning tables rather than adding a denormalized column, mirroring
   * `resolveRecipientUserId`'s per-purpose lookup.
   */
  async listPendingForCreator(userId: string) {
    const PENDING_STATUSES = ["CREATED", "AWAITING_PAYMENT"] as const;

    const [purchases, donations, subscriptions, gifts] = await Promise.all([
      this.prisma.purchase.findMany({
        where: { product: { creator: { userId } }, payment: { status: { in: [...PENDING_STATUSES] } } },
        include: { payment: true, product: { select: { title: true } }, user: { select: { username: true } } },
      }),
      this.prisma.donation.findMany({
        where: { creator: { userId }, payment: { status: { in: [...PENDING_STATUSES] } } },
        include: { payment: true, sender: { select: { username: true } } },
      }),
      this.prisma.subscription.findMany({
        where: { tier: { creator: { userId } }, payment: { status: { in: [...PENDING_STATUSES] } } },
        include: { payment: true, tier: { select: { name: true } }, user: { select: { username: true } } },
      }),
      // Every reward still being paid for: one sent on its own is its own
      // item; one riding on a tip or a subscription names that item.
      this.prisma.rewardGift.findMany({
        where: { creator: { userId }, status: "PENDING", payment: { status: { in: [...PENDING_STATUSES] } } },
        include: { payment: true, reward: { select: { emoji: { select: { shortcode: true } } } }, sender: { select: { username: true } } },
      }),
    ]);
    const rewardOn = new Map(gifts.map((g) => [g.paymentId, g.reward.emoji.shortcode]));

    const items = [
      ...purchases.map((p) => ({
        payment: p.payment!,
        kind: "PURCHASE" as const,
        label: p.product.title,
        payerUsername: p.user.username,
        rewardShortcode: null,
      })),
      ...donations.map((d) => ({
        payment: d.payment!,
        kind: "DONATION" as const,
        label: "Donation",
        payerUsername: d.sender?.username ?? null,
        rewardShortcode: rewardOn.get(d.paymentId) ?? null,
      })),
      ...subscriptions.map((s) => ({
        payment: s.payment!,
        kind: "SUBSCRIPTION" as const,
        label: s.tier.name,
        payerUsername: s.user.username,
        rewardShortcode: rewardOn.get(s.paymentId) ?? null,
      })),
      ...gifts
        .filter((g) => g.payment?.purpose === "REWARD")
        .map((g) => ({
          payment: g.payment!,
          kind: "REWARD" as const,
          label: `:${g.reward.emoji.shortcode}:`,
          // The author is told who sent it only if the sender agreed.
          payerUsername: g.anonymous ? null : g.sender?.username ?? null,
          rewardShortcode: g.reward.emoji.shortcode,
        })),
    ];

    return items.sort((a, b) => b.payment.createdAt.getTime() - a.payment.createdAt.getTime());
  }

  private async applyPaymentState(paymentId: string, state: { status: string }) {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });

      // Idempotency guard: a payment already terminal never regresses or
      // double-applies its side effects, no matter how many times an event
      // is replayed (spec rule #55).
      if (payment.status === "CONFIRMED" || payment.status === "REFUNDED") {
        return { payment, alreadyFinal: true };
      }

      const updated = await tx.payment.update({
        where: { id: paymentId },
        data: { status: state.status as never },
      });


      if (state.status === "CONFIRMED") {
        await this.completePurchase(tx, payment.id);
      } else if (state.status === "FAILED" || state.status === "EXPIRED") {
        await tx.purchase.updateMany({
          where: { paymentId: payment.id },
          data: { status: state.status === "EXPIRED" ? "CANCELLED" : "FAILED" },
        });
        await tx.donation.updateMany({
          where: { paymentId: payment.id },
          data: { status: state.status === "EXPIRED" ? "CANCELLED" : "FAILED" },
        });
        await tx.subscription.updateMany({
          where: { paymentId: payment.id, status: "PENDING" },
          data: { status: state.status === "EXPIRED" ? "CANCELLED" : "PAYMENT_FAILED" },
        });
        await this.rewards.cancelForPayment(tx, payment.id);
      }

      return { payment: updated, alreadyFinal: false };
    });
  }

  private async completePurchase(tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0], paymentId: string) {
    const purchase = await tx.purchase.findUnique({ where: { paymentId }, include: { product: true } });
    if (purchase && purchase.status !== "COMPLETED") {
      const userId = purchase.userId;
      await tx.purchase.update({ where: { id: purchase.id }, data: { status: "COMPLETED" } });

      // Delegate to EntitlementService rather than reimplementing bundle
      // fanout here — it's the single place that logic lives, passing
      // `tx` through so the grants commit atomically with the purchase
      // update above.
      if (purchase.product.type === "BUNDLE") {
        await this.entitlements.grantBundlePurchase(
          { userId, bundleProductId: purchase.productId, purchaseId: purchase.id },
          tx,
        );
      } else {
        await this.entitlements.grant(
          { userId, productId: purchase.productId, sourceType: "PRODUCT_PURCHASE", sourceId: purchase.id },
          tx,
        );
      }

      await tx.notification.create({
        data: { userId, type: "PRODUCT_PURCHASED", payload: { productId: purchase.productId } },
      });
    }

    const donation = await tx.donation.findUnique({ where: { paymentId } });
    if (donation && donation.status !== "COMPLETED") {
      await tx.donation.update({ where: { id: donation.id }, data: { status: "COMPLETED" } });
      const creatorProfile = await tx.creatorProfile.findUnique({
        where: { id: donation.creatorId },
        include: { user: { select: { username: true } } },
      });
      if (creatorProfile) {
        await tx.notification.create({
          data: { userId: creatorProfile.userId, type: "DONATION_RECEIVED", payload: { donationId: donation.id } },
        });
        // Anonymous (no-registration) donors have no account to notify.
        if (donation.senderUserId) {
          await tx.notification.create({
            data: {
              userId: donation.senderUserId,
              type: "WELCOME_MESSAGE",
              payload: { ...this.notifications.welcomePayload("DONOR", creatorProfile), creatorUsername: creatorProfile.user.username },
            },
          });
        }
      }
    }

    // Subscription access is checked dynamically against this row by
    // EntitlementService (spec rule #46) — no per-product entitlement rows
    // need to be pre-granted, so newly-added catalog items under a tier
    // become visible immediately without a backfill job.
    const subscription = await tx.subscription.findUnique({ where: { paymentId }, include: { tier: true } });
    if (subscription && subscription.status === "PENDING") {
      const periodMs = subscription.tier.period === "YEAR" ? 365 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
      const now = new Date();
      const isRenewal = (await tx.subscription.count({ where: { userId: subscription.userId, tierId: subscription.tierId, id: { not: subscription.id } } })) > 0;
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { status: "ACTIVE", startedAt: now, expiresAt: new Date(now.getTime() + periodMs) },
      });
      await this.notifySubscriptionActivated(tx, subscription, isRenewal);
    }

    await this.rewards.grantForPayment(tx, paymentId);
  }
}
