import { createHash } from "node:crypto";
import type { PrismaClient } from "@platform/db";
import { Money, type Currency } from "@platform/shared";
import { Errors } from "../../lib/errors.js";
import { storageService, type StorageBackend } from "../../lib/storage.js";
import { EntitlementService } from "../entitlements/service.js";
import { requireCreatorProfile, requireOwnedProduct, uniqueSlug } from "../products/product-helpers.js";
import type { CreateFileProductInput } from "./schemas.js";
import { megabytes, SettingsService } from "../settings/service.js";

/**
 * A file an author sells: one product, one file, gated by exactly the same
 * EntitlementService decision as every other product. The stored key never
 * leaves the server — a buyer only ever gets a URL to the download route,
 * which re-checks entitlement on every request rather than trusting a
 * decision made when the page was rendered.
 */
export class DigitalFileService {
  private readonly entitlements: EntitlementService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: StorageBackend = storageService,
  ) {
    this.entitlements = new EntitlementService(prisma);
  }

  async createProduct(userId: string, input: CreateFileProductInput) {
    const profile = await requireCreatorProfile(this.prisma, userId);

    if (input.visibility === "TIER" && !input.requiredTierId) {
      throw Errors.validation("A subscription tier is required for tier-gated visibility.");
    }

    // Same check ProductService.createPost makes. EntitlementService
    // fails closed, so a foreign tier id is not an access leak — it
    // produces a product nobody, not even a subscriber of that tier, can
    // ever open, with no error at creation time.
    if (input.requiredTierId) {
      const tier = await this.prisma.subscriptionTier.findUnique({ where: { id: input.requiredTierId } });
      if (!tier || tier.creatorId !== profile.id) {
        throw Errors.validation("That subscription tier doesn't belong to you.");
      }
    }

    const money = Money.fromDecimalString(input.priceDecimal, input.currency as Currency);
    const slug = await uniqueSlug(this.prisma, profile.id, input.title);

    return this.prisma.digitalProduct.create({
      data: {
        creatorId: profile.id,
        type: "DIGITAL_FILE",
        title: input.title,
        slug,
        description: input.description,
        visibility: input.visibility,
        requiredTierId: input.visibility === "TIER" ? input.requiredTierId : null,
        status: "DRAFT",
        prices: {
          create: [
            {
              currency: input.currency,
              amountMinor: money.amountMinor,
              pricingType: money.isZero() ? "FREE" : "ONE_TIME",
            },
          ],
        },
      },
      include: { prices: true },
    });
  }

  async attachFile(
    userId: string,
    productId: string,
    file: { buffer: Buffer; mimeType: string; filename: string },
  ) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const product = await requireOwnedProduct(this.prisma, profile.id, productId);
    if (product.type !== "DIGITAL_FILE") throw Errors.validation("This product isn't a file.");

    const limit = await new SettingsService(this.prisma).maxUploadBytes(userId);

    if (file.buffer.byteLength > limit) {
      throw Errors.validation(`Files must be ${megabytes(limit)} or smaller.`);
    }

    const checksum = createHash("sha256").update(file.buffer).digest("hex");
    const storageKey = await this.storage.save(file.buffer);

    // Read the key being replaced, but delete it only after the row is
    // updated. Deleting first would leave the row pointing at a missing
    // blob if the write failed — every buyer's download 404s, and it
    // looks identical to a product that never had a file.
    const existing = await this.prisma.digitalFile.findUnique({ where: { productId } });

    const saved = await this.prisma.digitalFile.upsert({
      where: { productId },
      update: {
        storageKey,
        mimeType: file.mimeType,
        sizeBytes: BigInt(file.buffer.byteLength),
        originalFilename: file.filename,
        checksumSha256: checksum,
      },
      create: {
        productId,
        storageKey,
        mimeType: file.mimeType,
        sizeBytes: BigInt(file.buffer.byteLength),
        originalFilename: file.filename,
        checksumSha256: checksum,
      },
    });

    if (existing && existing.storageKey !== storageKey) {
      await this.storage.delete(existing.storageKey);
    }

    return {
      id: saved.id,
      mimeType: saved.mimeType,
      sizeBytes: saved.sizeBytes.toString(),
      originalFilename: saved.originalFilename,
      checksumSha256: saved.checksumSha256,
    };
  }

  /**
   * Resolves a download for a requester, or throws. Mirrors
   * `AttachmentService.getForDownload`: entitlement is decided here, not
   * by the caller, and a missing blob is a 404 rather than a stream that
   * fails halfway.
   */
  async getForDownload(userId: string | null, productId: string) {
    const decision = await this.entitlements.canAccessProduct(userId, productId);
    if (!decision.allowed) throw Errors.forbidden();

    const file = await this.prisma.digitalFile.findUnique({ where: { productId } });
    if (!file) throw Errors.notFound("File");
    if (!(await this.storage.exists(file.storageKey))) throw Errors.notFound("File");

    return file;
  }
}
