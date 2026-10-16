import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@platform/db";
import { personalLinkTargets, resolvePersonalLinks } from "@platform/shared";
import { Errors } from "../../lib/errors.js";
import { config } from "../../config.js";

const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 7;
const CODE = /^[A-Za-z0-9]{4,32}$/;

function newCode(): string {
  const bytes = randomBytes(CODE_LENGTH * 2);
  let code = "";
  for (const b of bytes) {
    // Rejection sampling keeps every character equally likely.
    if (b >= 256 - (256 % ALPHABET.length)) continue;
    code += ALPHABET[b % ALPHABET.length];
    if (code.length === CODE_LENGTH) break;
  }
  return code.length === CODE_LENGTH ? code : newCode();
}

/** The address a code is reached at, on the site's own domain. */
export function shortUrl(code: string): string {
  return `${config.webOrigin.replace(/\/$/, "")}/s/${code}`;
}

/** Only the host of where a click came from — never the page, never its query. */
function referrerHost(referer: string | undefined): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).host.slice(0, 120) || null;
  } catch {
    return null;
  }
}

/**
 * Short links on this site's own domain (`/s/<code>`): ones a member makes
 * on the "Links" page, and personal ones made for each reader from a
 * post's `@[text](url)`. A use records when, from which site, and who —
 * only if they were signed in here; no address, nothing else.
 */
export class ShortLinkService {
  constructor(private readonly prisma: PrismaClient) {}

  private async uniqueCode(): Promise<string> {
    for (;;) {
      const code = newCode();
      if (!(await this.prisma.shortLink.findUnique({ where: { code }, select: { id: true } }))) return code;
    }
  }

  async create(ownerId: string, input: { url: string; title?: string }) {
    const link = await this.prisma.shortLink.create({
      data: { code: await this.uniqueCode(), ownerId, targetUrl: input.url, title: input.title || null },
    });
    return this.view(link);
  }

  private view(link: { id: string; code: string; targetUrl: string; title: string | null; clicks: number; createdAt: Date }) {
    return { id: link.id, code: link.code, shortUrl: shortUrl(link.code), targetUrl: link.targetUrl, title: link.title, clicks: link.clicks, createdAt: link.createdAt };
  }

  /** A member's own links (not the personal ones a post made), newest first. */
  async listMine(ownerId: string) {
    const links = await this.prisma.shortLink.findMany({ where: { ownerId, productId: null }, orderBy: { createdAt: "desc" }, take: 500 });
    return links.map((l) => this.view(l));
  }

  async remove(ownerId: string, id: string) {
    const { count } = await this.prisma.shortLink.deleteMany({ where: { id, ownerId, productId: null } });
    if (count === 0) throw Errors.notFound("Link");
  }

  /** Where a code goes, with the visit recorded — or null for a code that does not exist. */
  async follow(code: string, visit: { userId: string | null; referer?: string; query: Record<string, string | string[] | undefined> }): Promise<string | null> {
    if (!CODE.test(code)) return null;
    const link = await this.prisma.shortLink.findUnique({ where: { code } });
    if (!link) return null;
    // The owner's own clicks are not visits.
    if (visit.userId !== link.ownerId) {
      await this.prisma.$transaction([
        this.prisma.shortLink.update({ where: { id: link.id }, data: { clicks: { increment: 1 } } }),
        this.prisma.shortLinkClick.create({ data: { linkId: link.id, userId: visit.userId, referrerHost: referrerHost(visit.referer) } }),
      ]);
    }
    // The target keeps its own parameters; ones added to the short
    // address (utm_source=…) are carried on to it.
    const target = new URL(link.targetUrl);
    for (const [key, value] of Object.entries(visit.query)) {
      if (value === undefined) continue;
      for (const v of Array.isArray(value) ? value : [value]) target.searchParams.append(key, v);
    }
    return target.toString();
  }

  /** Uses of a link the member owns: the total, by day, by site, and the signed-in readers who used it. */
  async stats(ownerId: string, id: string) {
    const link = await this.prisma.shortLink.findFirst({ where: { id, ownerId } });
    if (!link) throw Errors.notFound("Link");
    return { link: this.view(link), ...(await this.usage([link.id])) };
  }

  private async usage(linkIds: string[]) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [clicks, readers, sites, anonymous] = await Promise.all([
      this.prisma.shortLinkClick.findMany({ where: { linkId: { in: linkIds }, createdAt: { gte: since } }, select: { createdAt: true } }),
      this.prisma.shortLinkClick.groupBy({
        by: ["userId"],
        where: { linkId: { in: linkIds }, userId: { not: null } },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      this.prisma.shortLinkClick.groupBy({ by: ["referrerHost"], where: { linkId: { in: linkIds } }, _count: { _all: true } }),
      this.prisma.shortLinkClick.count({ where: { linkId: { in: linkIds }, userId: null } }),
    ]);
    const byDay = new Map<string, number>();
    for (const c of clicks) {
      const day = c.createdAt.toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    const users = await this.prisma.user.findMany({
      where: { id: { in: readers.map((r) => r.userId!) } },
      select: { id: true, username: true },
    });
    const names = new Map(users.map((u) => [u.id, u.username]));
    return {
      byDay: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day, count })),
      readers: readers
        .filter((r) => names.has(r.userId!))
        .map((r) => ({ username: names.get(r.userId!)!, clicks: r._count._all, lastAt: r._max.createdAt }))
        .sort((a, b) => b.clicks - a.clicks),
      anonymous,
      sites: sites
        .map((s) => ({ host: s.referrerHost, count: s._count._all }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20),
    };
  }

  /**
   * The personal links an author's posts made: one row per post and
   * address, with how many readers got one, how many used it, and who.
   */
  async personalSummary(ownerId: string) {
    const groups = await this.prisma.shortLink.groupBy({
      by: ["productId", "targetUrl"],
      where: { ownerId, productId: { not: null } },
      _count: { _all: true },
      _sum: { clicks: true },
    });
    if (groups.length === 0) return [];
    const products = await this.prisma.digitalProduct.findMany({
      where: { id: { in: groups.map((g) => g.productId!) } },
      select: { id: true, title: true },
    });
    const titles = new Map(products.map((p) => [p.id, p.title]));
    return Promise.all(
      groups.map(async (g) => {
        const links = await this.prisma.shortLink.findMany({ where: { ownerId, productId: g.productId, targetUrl: g.targetUrl }, select: { id: true } });
        const usage = await this.usage(links.map((l) => l.id));
        return {
          productId: g.productId!,
          postTitle: titles.get(g.productId!) ?? "",
          targetUrl: g.targetUrl,
          links: g._count._all,
          clicks: g._sum.clicks ?? 0,
          readers: usage.readers,
          anonymous: usage.anonymous,
        };
      }),
    );
  }

  /**
   * A post's texts as a reader is to see them: each `@[text](url)` turned
   * into that reader's own short link (made the first time), or, for a
   * reader who is not signed in, one shared short link per post and
   * address. The author sees their links as written. All texts of a page
   * at once — two queries however many posts it holds.
   */
  async personalize(items: { productId: string; ownerId: string; text: string | null }[], readerId: string | null): Promise<(string | null)[]> {
    const wanted = items.flatMap((item) =>
      item.text && item.ownerId !== readerId ? personalLinkTargets(item.text).map((url) => ({ productId: item.productId, ownerId: item.ownerId, url })) : [],
    );
    if (wanted.length === 0) return items.map((item) => (item.text ? resolvePersonalLinks(item.text) : item.text));

    const existing = await this.prisma.shortLink.findMany({
      where: { readerId, productId: { in: [...new Set(wanted.map((w) => w.productId))] } },
      select: { productId: true, targetUrl: true, code: true },
    });
    const key = (productId: string, url: string) => `${productId}\u0000${url}`;
    const codes = new Map(existing.map((l) => [key(l.productId!, l.targetUrl), l.code]));
    const missing = wanted.filter((w) => !codes.has(key(w.productId, w.url)));
    if (missing.length) {
      const rows = await Promise.all(
        missing.map(async (w) => ({ code: await this.uniqueCode(), ownerId: w.ownerId, targetUrl: w.url, productId: w.productId, readerId })),
      );
      await this.prisma.shortLink.createMany({ data: rows, skipDuplicates: true });
      // Another request may have made some first: read back what stands.
      const made = await this.prisma.shortLink.findMany({
        where: { readerId, productId: { in: [...new Set(missing.map((m) => m.productId))] } },
        select: { productId: true, targetUrl: true, code: true },
      });
      for (const l of made) codes.set(key(l.productId!, l.targetUrl), l.code);
    }
    return items.map((item) => {
      if (!item.text) return item.text;
      if (item.ownerId === readerId) return resolvePersonalLinks(item.text);
      return resolvePersonalLinks(item.text, (url) => {
        const code = codes.get(key(item.productId, url));
        return code ? shortUrl(code) : undefined;
      });
    });
  }
}
