import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@platform/db";
import { Money, type Currency } from "@platform/shared";
import { Errors } from "../../lib/errors.js";
import { logAdminAction } from "../../lib/audit-log.js";
import { NotificationService } from "../notifications/service.js";
import { assertPayable } from "../payments/service.js";

type Client = PrismaClient | Prisma.TransactionClient;

const PAYMENT_TTL_MS = 15 * 60 * 1000;
/** One free reward from one person to one author a day: free ones are not a counter to run up. */
const FREE_GIFT_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface RewardView {
  id: string;
  shortcode: string;
  imageUrl: string;
  priceMinor: string;
  currency: string;
  free: boolean;
}

/**
 * Whether `userId` may react with the sticker `:shortcode:`. Any reader
 * may use an ordinary sticker; a reward only by an author who has been
 * given it — that is what makes it worth giving. Refuses with the reason.
 */
export async function assertMayReactWith(client: Client, shortcode: string, userId: string | null): Promise<void> {
  const sticker = await client.serverEmoji.findUnique({ where: { shortcode }, select: { reward: { select: { id: true } } } });
  if (!sticker) throw Errors.validation("There is no such sticker on this server.");
  if (!sticker.reward) return;
  const held = userId
    ? await client.rewardGift.count({ where: { rewardId: sticker.reward.id, status: "GRANTED", creator: { userId } } })
    : 0;
  if (held === 0) throw Errors.rewardNotHeld();
}

/**
 * The same rule for writing: a reward sticker (`:alias:`) in a post or a
 * comment is refused unless its writer is an author who was given it —
 * otherwise anyone could type the alias the picker hides from them.
 */
export async function assertMayWriteWith(client: Client, text: string, userId: string): Promise<void> {
  const aliases = [...new Set([...text.matchAll(/:([a-z0-9_+-]{1,40}):/gi)].map((m) => m[1]!.toLowerCase()))];
  if (aliases.length === 0) return;
  const rewards = await client.serverEmoji.findMany({
    where: { shortcode: { in: aliases }, reward: { isNot: null } },
    select: { reward: { select: { id: true } } },
  });
  if (rewards.length === 0) return;
  const held = await client.rewardGift.findMany({
    where: { rewardId: { in: rewards.map((r) => r.reward!.id) }, status: "GRANTED", creator: { userId } },
    select: { rewardId: true },
    distinct: ["rewardId"],
  });
  const heldIds = new Set(held.map((h) => h.rewardId));
  if (rewards.some((r) => !heldIds.has(r.reward!.id))) throw Errors.rewardNotHeldInText();
}

const rewardInclude = { emoji: { select: { shortcode: true, storageKey: true } } } as const;

function view(reward: { id: string; priceMinor: bigint; currency: string; emoji: { shortcode: string; storageKey: string } }): RewardView {
  return {
    id: reward.id,
    shortcode: reward.emoji.shortcode,
    imageUrl: `/emoji/files/${reward.emoji.storageKey}`,
    priceMinor: reward.priceMinor.toString(),
    currency: reward.currency,
    free: reward.priceMinor === 0n,
  };
}

/**
 * Rewards: server stickers the administrator offers for supporters to buy
 * for an author — on their own, or alongside a tip or a subscription, in
 * the same payment. A paid reward becomes the author's when the author
 * confirms that payment, exactly like everything else here; a free one at
 * once. What an author has been given, they can react with on anyone's
 * post — and nobody else can.
 */
export class RewardService {
  private readonly notifications: NotificationService;

  constructor(private readonly prisma: PrismaClient) {
    this.notifications = new NotificationService(prisma);
  }

  /** Public: what can be given, cheapest first. */
  async catalog(): Promise<RewardView[]> {
    const rewards = await this.prisma.reward.findMany({
      where: { active: true },
      include: rewardInclude,
      orderBy: [{ position: "asc" }, { priceMinor: "asc" }, { createdAt: "asc" }],
    });
    return rewards.map(view);
  }

  /** A reward that may be given right now, or the reason it may not. */
  private async requireActive(client: Client, rewardId: string) {
    const reward = await client.reward.findUnique({ where: { id: rewardId }, include: rewardInclude });
    if (!reward || !reward.active) throw Errors.notFound("Reward");
    return reward;
  }

  private async requireCreator(client: Client, username: string) {
    const creator = await client.creatorProfile.findFirst({ where: { user: { username, deletedAt: null, suspendedAt: null } } });
    if (!creator) throw Errors.notFound("Creator");
    return creator;
  }

  /**
   * A reward on its own. Free: given at once, to a signed-in sender, once a
   * day per author. Paid: a payment of its own, settled like any other —
   * by the author confirming it arrived.
   */
  async send(senderUserId: string | null, input: { creatorUsername: string; rewardId: string; message?: string; anonymous: boolean }) {
    const reward = await this.requireActive(this.prisma, input.rewardId);
    const creator = await this.requireCreator(this.prisma, input.creatorUsername);
    if (senderUserId && creator.userId === senderUserId) throw Errors.validation("You can't give a reward to yourself.");

    if (reward.priceMinor === 0n) {
      if (!senderUserId) throw Errors.unauthorized();
      const recent = await this.prisma.rewardGift.count({
        where: {
          senderUserId,
          creatorId: creator.id,
          amountMinor: 0n,
          status: "GRANTED",
          createdAt: { gt: new Date(Date.now() - FREE_GIFT_WINDOW_MS) },
        },
      });
      if (recent > 0) throw Errors.validation("You have already given this author a free reward today.");
      const gift = await this.prisma.$transaction(async (tx) => {
        const created = await tx.rewardGift.create({
          data: {
            rewardId: reward.id,
            creatorId: creator.id,
            senderUserId,
            amountMinor: 0n,
            currency: reward.currency,
            message: input.message,
            anonymous: input.anonymous,
            status: "GRANTED",
            grantedAt: new Date(),
          },
        });
        await this.notifyGranted(tx, created.id);
        return created;
      });
      return { gift, payment: null, manualInstructions: null };
    }

    await assertPayable(this.prisma, creator);
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          userId: senderUserId,
          purpose: "REWARD",
          amountMinor: reward.priceMinor,
          currency: reward.currency,
          status: "AWAITING_PAYMENT",
          idempotencyKey: randomUUID(),
          expiresAt: new Date(Date.now() + PAYMENT_TTL_MS),
        },
      });
      const gift = await tx.rewardGift.create({
        data: {
          rewardId: reward.id,
          creatorId: creator.id,
          senderUserId,
          paymentId: payment.id,
          amountMinor: reward.priceMinor,
          currency: reward.currency,
          message: input.message,
          anonymous: input.anonymous,
        },
      });
      return { gift, payment, manualInstructions: creator.manualPaymentInstructions };
    });
  }

  /**
   * A reward added to a tip's or a subscription's payment: same currency,
   * a real price (a free one is given on its own), and the amount the
   * payment grows by is returned. Granted with that payment.
   */
  async attachToPayment(
    tx: Prisma.TransactionClient,
    input: { rewardId: string; creatorId: string; senderUserId: string | null; paymentId: string; currency: string },
  ): Promise<bigint> {
    const reward = await this.requireActive(tx, input.rewardId);
    if (reward.priceMinor === 0n) throw Errors.validation("A free reward is given on its own, not with a payment.");
    if (reward.currency !== input.currency) {
      throw Errors.validation(`This reward is priced in ${reward.currency}; choose it on its own or pay in ${reward.currency}.`);
    }
    await tx.rewardGift.create({
      data: {
        rewardId: reward.id,
        creatorId: input.creatorId,
        senderUserId: input.senderUserId,
        paymentId: input.paymentId,
        amountMinor: reward.priceMinor,
        currency: reward.currency,
      },
    });
    return reward.priceMinor;
  }

  /** The price a reward would add to a payment in `currency`, checked the same way. */
  async priceToAttach(rewardId: string, currency: string): Promise<bigint> {
    const reward = await this.requireActive(this.prisma, rewardId);
    if (reward.priceMinor === 0n) throw Errors.validation("A free reward is given on its own, not with a payment.");
    if (reward.currency !== currency) {
      throw Errors.validation(`This reward is priced in ${reward.currency}; choose it on its own or pay in ${reward.currency}.`);
    }
    return reward.priceMinor;
  }

  /** The payment arrived: every reward riding on it is the author's now. */
  async grantForPayment(tx: Prisma.TransactionClient, paymentId: string): Promise<void> {
    const pending = await tx.rewardGift.findMany({ where: { paymentId, status: "PENDING" }, select: { id: true } });
    for (const gift of pending) {
      await tx.rewardGift.update({ where: { id: gift.id }, data: { status: "GRANTED", grantedAt: new Date() } });
      await this.notifyGranted(tx, gift.id);
    }
  }

  async cancelForPayment(tx: Prisma.TransactionClient, paymentId: string): Promise<void> {
    await tx.rewardGift.updateMany({ where: { paymentId, status: "PENDING" }, data: { status: "CANCELLED" } });
  }

  private async notifyGranted(client: Client, giftId: string) {
    const gift = await client.rewardGift.findUniqueOrThrow({
      where: { id: giftId },
      include: { reward: { include: rewardInclude }, creator: { select: { userId: true } }, sender: { select: { username: true } } },
    });
    await this.notifications.notify(
      gift.creator.userId,
      "REWARD_RECEIVED",
      {
        giftId: gift.id,
        rewardShortcode: gift.reward.emoji.shortcode,
        senderUsername: gift.anonymous ? null : gift.sender?.username ?? null,
        message: gift.message,
      },
      client,
    );
  }

  /** An author's collection: each reward once, with how many they hold. */
  private async collection(creatorId: string) {
    const grouped = await this.prisma.rewardGift.groupBy({
      by: ["rewardId"],
      where: { creatorId, status: "GRANTED" },
      _count: { _all: true },
      _max: { grantedAt: true },
    });
    const rewards = await this.prisma.reward.findMany({ where: { id: { in: grouped.map((g) => g.rewardId) } }, include: rewardInclude });
    const byId = new Map(rewards.map((r) => [r.id, r]));
    return grouped
      .flatMap((g) => {
        const reward = byId.get(g.rewardId);
        return reward ? [{ reward: view(reward), count: g._count._all, lastAt: g._max.grantedAt }] : [];
      })
      .sort((a, b) => (b.lastAt?.getTime() ?? 0) - (a.lastAt?.getTime() ?? 0));
  }

  /** Public: what an author has been given. Never who gave it. */
  async forCreator(username: string) {
    const creator = await this.requireCreator(this.prisma, username);
    return (await this.collection(creator.id)).map(({ reward, count }) => ({ reward, count }));
  }

  /** The author's own view: their collection, and the latest gifts with who sent them. */
  async received(userId: string) {
    const creator = await this.prisma.creatorProfile.findUnique({ where: { userId } });
    if (!creator) return { collection: [], recent: [] };
    const recent = await this.prisma.rewardGift.findMany({
      where: { creatorId: creator.id, status: "GRANTED" },
      include: { reward: { include: rewardInclude }, sender: { select: { username: true } } },
      orderBy: { grantedAt: "desc" },
      take: 50,
    });
    return {
      collection: await this.collection(creator.id),
      recent: recent.map((g) => ({
        id: g.id,
        reward: view(g.reward),
        senderUsername: g.anonymous ? null : g.sender?.username ?? null,
        message: g.message,
        grantedAt: g.grantedAt,
        free: g.amountMinor === 0n,
      })),
    };
  }

  /** The reward stickers this person may react with: the ones given to them as an author. */
  async ownedShortcodes(userId: string): Promise<string[]> {
    const rows = await this.prisma.rewardGift.findMany({
      where: { status: "GRANTED", creator: { userId } },
      distinct: ["rewardId"],
      select: { reward: { select: { emoji: { select: { shortcode: true } } } } },
    });
    return rows.map((r) => r.reward.emoji.shortcode);
  }

  // --- administrator -------------------------------------------------------

  async adminList() {
    const rewards = await this.prisma.reward.findMany({
      include: { ...rewardInclude, _count: { select: { gifts: { where: { status: "GRANTED" } } } } },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    return rewards.map((r) => ({ ...view(r), emojiId: r.emojiId, active: r.active, position: r.position, given: r._count.gifts }));
  }

  /** Offer a server sticker as a reward, or change its price. */
  async adminUpsert(adminId: string, emojiId: string, input: { priceDecimal: string; currency: Currency; active: boolean; position?: number }) {
    const emoji = await this.prisma.serverEmoji.findUnique({ where: { id: emojiId } });
    if (!emoji) throw Errors.notFound("Sticker");
    const price = Money.fromDecimalString(input.priceDecimal, input.currency);
    const reward = await this.prisma.reward.upsert({
      where: { emojiId },
      create: { emojiId, priceMinor: price.amountMinor, currency: input.currency, active: input.active, position: input.position ?? 0 },
      update: { priceMinor: price.amountMinor, currency: input.currency, active: input.active, ...(input.position !== undefined ? { position: input.position } : {}) },
      include: rewardInclude,
    });
    await logAdminAction(this.prisma, adminId, "REWARD_SET", "Reward", reward.id, { emojiId, priceMinor: price.amountMinor.toString(), currency: input.currency, active: input.active });
    return view(reward);
  }

  /**
   * Stop offering a sticker as a reward. One that has already been given
   * stays a reward — the authors who hold it keep reacting with it — and
   * is only taken off sale.
   */
  async adminRemove(adminId: string, emojiId: string) {
    const reward = await this.prisma.reward.findUnique({ where: { emojiId }, include: { _count: { select: { gifts: true } } } });
    if (!reward) throw Errors.notFound("Reward");
    if (reward._count.gifts > 0) {
      await this.prisma.reward.update({ where: { id: reward.id }, data: { active: false } });
    } else {
      await this.prisma.reward.delete({ where: { id: reward.id } });
    }
    await logAdminAction(this.prisma, adminId, "REWARD_REMOVED", "Reward", reward.id, { emojiId, kept: reward._count.gifts > 0 });
  }
}
