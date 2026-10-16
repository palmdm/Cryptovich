import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@platform/db";
import { Errors } from "../../lib/errors.js";
import { requireCreatorProfile } from "../products/product-helpers.js";
import { normalizeTagName, type CreateCategoryInput, type UpdateCategoryInput } from "./schemas.js";

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "category"
  );
}

/**
 * Two ways of grouping posts, deliberately different in scope:
 *
 * Categories belong to one author and are ordered — they are the sections
 * of that author's page, and only the author creates them.
 *
 * Tags are global and unordered — free keywords shared across the
 * platform, created implicitly by using them.
 */
export class TaxonomyService {
  constructor(private readonly prisma: PrismaClient) {}

  // --- categories ---------------------------------------------------------

  /**
   * Counts both totals so the dashboard can explain the public page's
   * behaviour rather than leaving it to look broken: a section with posts
   * attached but none published looks identical to an empty one on
   * `/categories/:username` (both are omitted), and without a count here
   * an author has no way to tell "nothing assigned yet" from "assigned,
   * just not live" from where they are creating and filing posts.
   */
  async listMyCategories(userId: string) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const categories = await this.prisma.productCategory.findMany({
      where: { creatorId: profile.id },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      include: {
        _count: {
          select: {
            items: true,
            // Prisma's relation _count has no built-in way to filter by a
            // second hop (item -> product -> status), so the published
            // figure is computed separately below instead.
          },
        },
      },
    });

    const publishedCounts = await this.prisma.productCategoryItem.groupBy({
      by: ["categoryId"],
      where: {
        categoryId: { in: categories.map((c) => c.id) },
        product: { status: "PUBLISHED", deletedAt: null },
      },
      _count: true,
    });
    const publishedById = new Map(publishedCounts.map((row) => [row.categoryId, row._count]));

    return categories.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      totalItems: c._count.items,
      publishedItems: publishedById.get(c.id) ?? 0,
    }));
  }

  async listCategoriesFor(username: string) {
    const profile = await this.prisma.creatorProfile.findFirst({ where: { user: { username } } });
    if (!profile) return [];
    const categories = await this.prisma.productCategory.findMany({
      where: { creatorId: profile.id },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      include: {
        _count: { select: { items: { where: { product: { status: "PUBLISHED", deletedAt: null } } } } },
      },
    });
    // A category with nothing published in it is an empty room; the public
    // page doesn't offer it as a filter.
    return categories
      .filter((c) => c._count.items > 0)
      .map((c) => ({ id: c.id, name: c.name, slug: c.slug, postCount: c._count.items }));
  }

  async createCategory(userId: string, input: CreateCategoryInput) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const base = slugify(input.name);

    // Slugs are unique per author, so a second "Devlogs" gets -2 rather
    // than failing in front of the author.
    let slug = base;
    for (let n = 2; n < 100; n += 1) {
      const clash = await this.prisma.productCategory.findUnique({
        where: { creatorId_slug: { creatorId: profile.id, slug } },
      });
      if (!clash) break;
      // Past the counted attempts, fall back to a random suffix rather
      // than creating with a slug still known to collide, which would
      // surface as an unhandled unique violation.
      slug = n === 99 ? `${base}-${randomUUID().slice(0, 8)}` : `${base}-${n}`;
    }

    const last = await this.prisma.productCategory.findFirst({
      where: { creatorId: profile.id },
      orderBy: { position: "desc" },
    });

    return this.prisma.productCategory.create({
      data: { creatorId: profile.id, name: input.name, slug, position: (last?.position ?? -1) + 1 },
    });
  }

  async updateCategory(userId: string, id: string, input: UpdateCategoryInput) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const category = await this.prisma.productCategory.findUnique({ where: { id } });
    if (!category || category.creatorId !== profile.id) throw Errors.notFound("Category");
    return this.prisma.productCategory.update({ where: { id }, data: input });
  }

  async deleteCategory(userId: string, id: string) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const category = await this.prisma.productCategory.findUnique({ where: { id } });
    if (!category || category.creatorId !== profile.id) throw Errors.notFound("Category");
    // Cascades to ProductCategoryItem: posts survive, they just leave the section.
    await this.prisma.productCategory.delete({ where: { id } });
  }

  // --- assignment ---------------------------------------------------------

  private async requireOwnedProduct(userId: string, productId: string) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const product = await this.prisma.digitalProduct.findUnique({ where: { id: productId } });
    if (!product || product.creatorId !== profile.id || product.deletedAt) throw Errors.notFound("Post");
    return { profile, product };
  }

  async setProductCategories(userId: string, productId: string, categoryIds: string[]) {
    const { profile } = await this.requireOwnedProduct(userId, productId);

    if (categoryIds.length > 0) {
      const owned = await this.prisma.productCategory.count({
        where: { id: { in: categoryIds }, creatorId: profile.id },
      });
      // Refuses silently-partial writes: filing a post under someone
      // else's category would otherwise just drop that id.
      if (owned !== new Set(categoryIds).size) throw Errors.notFound("Category");
    }

    await this.prisma.$transaction([
      this.prisma.productCategoryItem.deleteMany({ where: { productId } }),
      this.prisma.productCategoryItem.createMany({
        data: [...new Set(categoryIds)].map((categoryId) => ({ productId, categoryId })),
      }),
    ]);

    return this.listProductTaxonomy(productId);
  }

  async setProductTags(userId: string, productId: string, tags: string[]) {
    await this.requireOwnedProduct(userId, productId);

    const names = [...new Set(tags.map(normalizeTagName).filter(Boolean))];

    // Tags are global, so two authors using the same new word at the same
    // moment race on the unique name. An upsert per name would surface
    // that as a P2002 and a 500; insert-ignoring then reading back cannot.
    if (names.length > 0) {
      await this.prisma.productTag.createMany({
        data: names.map((name) => ({ name })),
        skipDuplicates: true,
      });
    }
    const rows = await this.prisma.productTag.findMany({ where: { name: { in: names } } });

    await this.prisma.$transaction([
      this.prisma.productTagItem.deleteMany({ where: { productId } }),
      this.prisma.productTagItem.createMany({ data: rows.map((tag) => ({ productId, tagId: tag.id })) }),
    ]);

    return this.listProductTaxonomy(productId);
  }

  async listProductTaxonomy(productId: string) {
    const [categories, tags] = await Promise.all([
      this.prisma.productCategoryItem.findMany({
        where: { productId },
        include: { category: { select: { id: true, name: true, slug: true } } },
      }),
      this.prisma.productTagItem.findMany({
        where: { productId },
        include: { tag: { select: { id: true, name: true } } },
      }),
    ]);

    return {
      categories: categories.map((c) => c.category),
      tags: tags.map((t) => t.tag),
    };
  }
}
