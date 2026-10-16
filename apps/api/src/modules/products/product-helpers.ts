import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@platform/db";
import { Errors } from "../../lib/errors.js";
import { slugify } from "../../lib/slug.js";

export async function requireCreatorProfile(prisma: PrismaClient, userId: string) {
  const profile = await prisma.creatorProfile.findUnique({ where: { userId } });
  if (!profile) throw Errors.forbidden();
  return profile;
}

/**
 * A slug not yet taken by this author. Slugs are only the older link form
 * now (posts live at `/<author>/posts/<id>`), so a taken one gets a short
 * random suffix rather than the next free number — counting up from zero
 * cost a query per existing "item-N", and every title outside Latin script
 * slugifies to "item".
 */
export async function uniqueSlug(prisma: PrismaClient, creatorId: string, base: string): Promise<string> {
  const slug = slugify(base);
  const taken = await prisma.digitalProduct.findUnique({ where: { creatorId_slug: { creatorId, slug } } });
  if (!taken) return slug;
  for (;;) {
    const candidate = `${slug}-${randomUUID().slice(0, 8)}`;
    const existing = await prisma.digitalProduct.findUnique({ where: { creatorId_slug: { creatorId, slug: candidate } } });
    if (!existing) return candidate;
  }
}

export async function requireOwnedProduct(prisma: PrismaClient, creatorId: string, productId: string) {
  const product = await prisma.digitalProduct.findUnique({ where: { id: productId } });
  if (!product || product.creatorId !== creatorId || product.deletedAt) throw Errors.notFound("Product");
  return product;
}
