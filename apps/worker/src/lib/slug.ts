import { randomUUID } from "node:crypto";
import { prisma } from "@platform/db";

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "item"
  );
}

/**
 * A slug not yet taken by this author. Slugs are only the older link form
 * now (posts live at `/<author>/posts/<id>`), so a taken one gets a short
 * random suffix rather than the next free number — counting up from zero
 * cost a query per existing "item-N", and a title in any script but Latin
 * slugifies to "item", so a thousand imported posts was half a million
 * queries.
 */
export async function uniqueSlug(creatorId: string, base: string): Promise<string> {
  const slug = slugify(base);
  const taken = await prisma.digitalProduct.findUnique({ where: { creatorId_slug: { creatorId, slug } } });
  if (!taken) return slug;
  for (;;) {
    const candidate = `${slug}-${randomUUID().slice(0, 8)}`;
    const existing = await prisma.digitalProduct.findUnique({ where: { creatorId_slug: { creatorId, slug: candidate } } });
    if (!existing) return candidate;
  }
}
