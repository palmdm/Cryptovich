import type { PrismaClient } from "@platform/db";
import { Money, type Currency } from "@platform/shared";
import { Errors } from "../../lib/errors.js";
import { requireCreatorProfile } from "../products/product-helpers.js";
import { storageService } from "../../lib/storage.js";
import { MIME_TO_EXT } from "../../lib/image-mime.js";
import { processImage } from "../../lib/image-resize.js";
import { megabytes, SettingsService } from "../settings/service.js";
import type { CreateTierInput, UpdateTierInput } from "./schemas.js";

export class TierService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Price 0 is allowed and deliberate — a "follow, get notified of new
   * posts, no payment" tier (checkout for it activates instantly with no
   * Payment row; see `PaymentService.startSubscriptionCheckout`). */
  async create(userId: string, input: CreateTierInput) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const money = Money.fromDecimalString(input.priceDecimal, input.currency);

    return this.prisma.subscriptionTier.create({
      data: {
        creatorId: profile.id,
        name: input.name,
        description: input.description,
        period: input.period,
        currency: input.currency,
        amountMinor: money.amountMinor,
      },
    });
  }

  async update(userId: string, tierId: string, input: UpdateTierInput) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const tier = await this.prisma.subscriptionTier.findUnique({ where: { id: tierId } });
    if (!tier || tier.creatorId !== profile.id) throw Errors.notFound("Subscription tier");

    return this.prisma.subscriptionTier.update({
      where: { id: tierId },
      data: {
        name: input.name,
        description: input.description,
        status: input.status,
        discountPercent: input.discountPercent,
        discountEndsAt: input.discountEndsAt === undefined ? undefined : input.discountEndsAt === null ? null : new Date(input.discountEndsAt),
        ...(input.priceDecimal !== undefined ? { amountMinor: Money.fromDecimalString(input.priceDecimal, tier.currency as Currency).amountMinor } : {}),
      },
    });
  }

  private async ownTier(userId: string, tierId: string) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const tier = await this.prisma.subscriptionTier.findUnique({ where: { id: tierId } });
    if (!tier || tier.creatorId !== profile.id) throw Errors.notFound("Subscription tier");
    return tier;
  }

  /** The tier's picture, re-encoded like a cover and served from `/covers/`. */
  async setImage(userId: string, tierId: string, file: { buffer: Buffer; mimeType: string }) {
    await this.ownTier(userId, tierId);
    const extension = MIME_TO_EXT[file.mimeType];
    if (!extension) throw Errors.validation("Covers must be a PNG, JPEG, GIF, or WebP image.");
    const limit = await new SettingsService(this.prisma).maxUploadBytes(userId);
    if (file.buffer.byteLength > limit) throw Errors.validation(`Covers must be ${megabytes(limit)} or smaller.`);
    const processed = await processImage(file.buffer, file.mimeType, "cover");
    const key = await storageService.save(processed.buffer, processed.extension);
    // The previous picture is left to the nightly clean-up (worker).
    return this.prisma.subscriptionTier.update({ where: { id: tierId }, data: { imageUrl: `/covers/${key}` } });
  }

  async removeImage(userId: string, tierId: string) {
    await this.ownTier(userId, tierId);
    return this.prisma.subscriptionTier.update({ where: { id: tierId }, data: { imageUrl: null } });
  }

  async listMine(userId: string) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    return this.prisma.subscriptionTier.findMany({ where: { creatorId: profile.id }, orderBy: { amountMinor: "asc" } });
  }

  async listPublic(username: string) {
    const creator = await this.prisma.creatorProfile.findFirst({ where: { user: { username } } });
    if (!creator) throw Errors.notFound("Creator");
    return this.prisma.subscriptionTier.findMany({
      where: { creatorId: creator.id, status: "ACTIVE" },
      orderBy: { amountMinor: "asc" },
    });
  }
}
