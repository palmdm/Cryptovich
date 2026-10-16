import type { PrismaClient } from "@platform/db";
import { Money } from "@platform/shared";
import { Errors } from "../../lib/errors.js";
import { requireCreatorProfile, requireOwnedProduct } from "../products/product-helpers.js";
import type { SetPriceInput } from "./schemas.js";

export class StickerPackService {
  constructor(private readonly prisma: PrismaClient) {}

  async setPrice(userId: string, productId: string, input: SetPriceInput) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const product = await requireOwnedProduct(this.prisma, profile.id, productId);
    if (product.type !== "STICKER_PACK") throw Errors.validation("This product is not a sticker pack.");

    const money = Money.fromDecimalString(input.priceDecimal, input.currency);
    const pricingType = money.isZero() ? "FREE" : "ONE_TIME";

    await this.prisma.productPrice.updateMany({ where: { productId, active: true }, data: { active: false } });
    await this.prisma.productPrice.create({
      data: { productId, currency: input.currency, amountMinor: money.amountMinor, pricingType },
    });

    return this.prisma.digitalProduct.update({ where: { id: productId }, data: { visibility: input.visibility } });
  }
}
