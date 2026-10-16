import type { PrismaClient } from "@platform/db";
import { Errors } from "../../lib/errors.js";
import { requireCreatorProfile } from "../products/product-helpers.js";
import { NotificationService } from "../notifications/service.js";
import type { CreateDiscountCodeInput } from "./schemas.js";

export class DiscountCodeService {
  private readonly notifications: NotificationService;

  constructor(private readonly prisma: PrismaClient) {
    this.notifications = new NotificationService(prisma);
  }

  async create(userId: string, input: CreateDiscountCodeInput) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    if (input.type === "PERCENT_OFF" && input.value > 100) {
      throw Errors.validation("A percentage discount can't exceed 100.");
    }

    const existing = await this.prisma.discountCode.findUnique({
      where: { creatorId_code: { creatorId: profile.id, code: input.code } },
    });
    if (existing) throw Errors.validation("You already have a discount code with that name.");

    const created = await this.prisma.discountCode.create({
      data: {
        creatorId: profile.id,
        code: input.code,
        type: input.type,
        value: input.value,
        maxRedemptions: input.maxRedemptions,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
      },
    });

    // The people it is for are the ones already subscribed to this
    // author — a code nobody hears about discounts nothing. Best-effort:
    // a notification failure must not undo a created code.
    try {
      const subscribers = await this.prisma.subscription.findMany({
        where: { status: "ACTIVE", expiresAt: { gt: new Date() }, tier: { creatorId: profile.id } },
        select: { userId: true },
        distinct: ["userId"],
      });
      await this.notifications.notifyMany(
        subscribers.map((s) => s.userId),
        "DISCOUNT_AVAILABLE",
        {
          code: created.code,
          type: created.type,
          value: created.value,
          creatorName: profile.displayName,
          creatorUsername: (
            await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { username: true } })
          ).username,
        },
      );
    } catch {
      // Logged by the caller's error handler if it matters; the code exists either way.
    }

    return created;
  }

  async listMine(userId: string) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    return this.prisma.discountCode.findMany({ where: { creatorId: profile.id }, orderBy: { createdAt: "desc" } });
  }

  async deactivate(userId: string, codeId: string) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const code = await this.prisma.discountCode.findUnique({ where: { id: codeId } });
    if (!code || code.creatorId !== profile.id) throw Errors.notFound("Discount code");
    return this.prisma.discountCode.update({ where: { id: codeId }, data: { active: false } });
  }
}
