import type { PrismaClient } from "@platform/db";
import { Money, type Currency } from "@platform/shared";
import { Errors } from "../../lib/errors.js";
import { requireCreatorProfile, requireOwnedProduct, uniqueSlug } from "../products/product-helpers.js";
import { PricingService } from "../pricing/service.js";
import type { CreateBundleInput, UpdateBundleInput } from "./schemas.js";

export class BundleService {
  private readonly pricing: PricingService;

  constructor(private readonly prisma: PrismaClient) {
    this.pricing = new PricingService(prisma);
  }

  async create(userId: string, input: CreateBundleInput) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const slug = await uniqueSlug(this.prisma, profile.id, input.title);
    const money = Money.fromDecimalString(input.priceDecimal, input.currency);

    return this.prisma.digitalProduct.create({
      data: {
        creatorId: profile.id,
        type: "BUNDLE",
        title: input.title,
        slug,
        description: input.description,
        coverUrl: input.coverUrl,
        visibility: "PURCHASED",
        status: "DRAFT",
        prices: { create: [{ currency: input.currency, amountMinor: money.amountMinor, pricingType: "ONE_TIME" }] },
      },
      include: { prices: true },
    });
  }

  async update(userId: string, bundleId: string, input: UpdateBundleInput) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const bundle = await requireOwnedProduct(this.prisma, profile.id, bundleId);
    if (bundle.type !== "BUNDLE") throw Errors.validation("This product is not a bundle.");

    if (input.priceDecimal !== undefined) {
      const activePrice = await this.pricing.getActivePrice(bundleId);
      const currency = activePrice?.currency ?? "USD";
      const money = Money.fromDecimalString(input.priceDecimal, currency as Currency);
      await this.prisma.productPrice.updateMany({ where: { productId: bundleId, active: true }, data: { active: false } });
      await this.prisma.productPrice.create({
        data: { productId: bundleId, currency, amountMinor: money.amountMinor, pricingType: "ONE_TIME" },
      });
    }

    return this.prisma.digitalProduct.update({
      where: { id: bundleId },
      data: {
        title: input.title,
        description: input.description,
        coverUrl: input.coverUrl,
      },
    });
  }

  async addItem(userId: string, bundleId: string, itemProductId: string) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const bundle = await requireOwnedProduct(this.prisma, profile.id, bundleId);
    if (bundle.type !== "BUNDLE") throw Errors.validation("This product is not a bundle.");
    if (itemProductId === bundleId) throw Errors.validation("A bundle cannot contain itself.");

    const item = await requireOwnedProduct(this.prisma, profile.id, itemProductId);
    if (item.type === "BUNDLE") throw Errors.validation("A bundle cannot contain another bundle.");

    const position = await this.prisma.productItem.count({ where: { productId: bundleId } });

    return this.prisma.productItem.upsert({
      where: { productId_itemProductId: { productId: bundleId, itemProductId } },
      update: {},
      create: { productId: bundleId, itemProductId, position },
    });
  }

  async removeItem(userId: string, bundleId: string, itemProductId: string) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    await requireOwnedProduct(this.prisma, profile.id, bundleId);
    await this.prisma.productItem.deleteMany({ where: { productId: bundleId, itemProductId } });
  }

  async reorder(userId: string, bundleId: string, itemProductIds: string[]) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    await requireOwnedProduct(this.prisma, profile.id, bundleId);

    await this.prisma.$transaction(
      itemProductIds.map((itemProductId, position) =>
        this.prisma.productItem.updateMany({
          where: { productId: bundleId, itemProductId },
          data: { position },
        }),
      ),
    );
  }

  /**
   * Bundle detail for the store/product page: computed pricing (never
   * trust the client), the member products, and — when a user is signed
   * in — how many of the bundle's items they already own (spec rule #123).
   */
  async getDetail(bundleProductId: string, viewerUserId: string | null) {
    const items = await this.prisma.productItem.findMany({
      where: { productId: bundleProductId },
      orderBy: { position: "asc" },
      include: { itemProduct: { include: { prices: { where: { active: true } } } } },
    });

    const pricing = await this.pricing.computeBundlePricing(bundleProductId);

    let ownedItemIds = new Set<string>();
    if (viewerUserId) {
      const entitlements = await this.prisma.entitlement.findMany({
        where: {
          userId: viewerUserId,
          productId: { in: items.map((i) => i.itemProductId) },
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { productId: true },
      });
      ownedItemIds = new Set(entitlements.map((e) => e.productId!));
    }

    return {
      pricing,
      items: items.map((i) => ({
        id: i.itemProduct.id,
        type: i.itemProduct.type,
        title: i.itemProduct.title,
        slug: i.itemProduct.slug,
        coverUrl: i.itemProduct.coverUrl,
        owned: ownedItemIds.has(i.itemProductId),
      })),
      ownedCount: ownedItemIds.size,
      totalCount: items.length,
    };
  }
}
