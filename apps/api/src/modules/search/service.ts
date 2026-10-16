import type { PrismaClient } from "@platform/db";
import { EntitlementService } from "../entitlements/service.js";
import { postExcerpt } from "../../lib/excerpt.js";

/**
 * One search across the three things a reader looks for: authors, posts
 * and tags.
 *
 * Two rules it inherits from the rest of the platform:
 *
 *  - Reading is open, so search works signed out and returns the same
 *    authors and posts the directory does.
 *  - A gated post is *listed*, never opened: it keeps its title and its
 *    place in the results, and its body — the excerpt — travels only for
 *    a reader who may read it. Searching the body of a paid post would be
 *    a way to read it a word at a time, so the text match itself is over
 *    what is already public (title, description) plus the body of posts
 *    that are public anyway.
 */

const LIMIT = 20;

export interface SearchResults {
  query: string;
  creators: { username: string; displayName: string; bio: string | null; avatarUrl: string | null; avatarFrame: string | null; publishedProductCount: number }[];
  posts: {
    id: string;
    title: string;
    slug: string;
    creatorUsername: string;
    creatorDisplayName: string;
    visibility: string;
    publishedAt: Date | null;
    canAccess: boolean;
    excerpt: string | null;
    tags: { id: string; name: string }[];
  }[];
  tags: { id: string; name: string; postCount: number }[];
}

export class SearchService {
  private readonly entitlements: EntitlementService;

  constructor(private readonly prisma: PrismaClient) {
    this.entitlements = new EntitlementService(prisma);
  }

  async search(rawQuery: string, viewerId: string | null): Promise<SearchResults> {
    const query = rawQuery.trim();
    if (query.length < 2) return { query, creators: [], posts: [], tags: [] };

    const [creators, products, tags] = await Promise.all([
      this.creators(query),
      this.posts(query),
      this.tags(query),
    ]);

    const allowed = await this.entitlements.allowedProductIds(
      viewerId,
      products.map((p) => ({
        id: p.id,
        creatorId: p.creatorId,
        creatorUserId: p.creator.userId,
        status: p.status,
        visibility: p.visibility,
        requiredTierId: p.requiredTierId,
        requiredGoalId: p.requiredGoalId,
      })),
    );

    return {
      query,
      creators: creators.map((profile) => ({
        username: profile.user.username,
        displayName: profile.displayName,
        bio: profile.bio,
        avatarUrl: profile.avatarUrl,
        avatarFrame: profile.avatarFrame,
        publishedProductCount: profile._count.products,
      })),
      posts: products.map((product) => ({
        id: product.id,
        title: product.title,
        slug: product.slug,
        creatorUsername: product.creator.user.username,
        creatorDisplayName: product.creator.displayName,
        visibility: product.visibility,
        publishedAt: product.publishedAt,
        canAccess: allowed.has(product.id),
        excerpt: allowed.has(product.id) ? postExcerpt(product.post) : null,
        tags: product.tags.map((t) => t.tag),
      })),
      tags,
    };
  }

  private creators(query: string) {
    return this.prisma.creatorProfile.findMany({
      where: {
        user: { deletedAt: null, suspendedAt: null },
        OR: [
          { displayName: { contains: query, mode: "insensitive" } },
          { user: { username: { contains: query, mode: "insensitive" } } },
          { bio: { contains: query, mode: "insensitive" } },
        ],
      },
      include: {
        user: { select: { username: true } },
        _count: { select: { products: { where: { status: "PUBLISHED", deletedAt: null } } } },
      },
      orderBy: { displayName: "asc" },
      take: LIMIT,
    });
  }

  private posts(query: string) {
    return this.prisma.digitalProduct.findMany({
      where: {
        status: "PUBLISHED",
        deletedAt: null,
        creator: { user: { deletedAt: null, suspendedAt: null } },
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
          // The body only where the body is public anyway: a paid post's
          // text must not be searchable by anyone who has not bought it.
          { visibility: "PUBLIC", post: { content: { contains: query, mode: "insensitive" } } },
          { tags: { some: { tag: { name: { contains: query, mode: "insensitive" } } } } },
        ],
      },
      include: {
        post: { select: { excerpt: true, content: true } },
        creator: { select: { userId: true, displayName: true, user: { select: { username: true } } } },
        tags: { include: { tag: { select: { id: true, name: true } } } },
      },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: LIMIT,
    });
  }

  private async tags(query: string) {
    const rows = await this.prisma.productTag.findMany({
      where: { name: { contains: query, mode: "insensitive" } },
      include: { _count: { select: { items: true } } },
      orderBy: { name: "asc" },
      take: LIMIT,
    });
    return rows.map((tag) => ({ id: tag.id, name: tag.name, postCount: tag._count.items }));
  }
}
