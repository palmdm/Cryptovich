import { postPathFor } from "@platform/shared";
import type { Prisma, PrismaClient } from "@platform/db";
import { Errors } from "../../lib/errors.js";
import { logAdminAction } from "../../lib/audit-log.js";
import type { SuspendUserInput, ResolveReportInput, SetInstanceStatusInput } from "./schemas.js";

const PAGE_SIZE = 50;

export class AdminService {
  constructor(private readonly prisma: PrismaClient) {}

  async listUsers(cursor?: string) {
    return this.prisma.user.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        createdAt: true,
        suspendedAt: true,
        deletedAt: true,
        canUploadFiles: true,
      },
    });
  }

  /**
   * Lets an account store files on this server — post images and
   * attachments. The operator's call, made per account from the admin
   * area; it used to be granted only as a side effect of approving API
   * access, so there was no way to give it to someone on its own.
   */
  async setUploads(adminId: string, userId: string, allowed: boolean) {
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw Errors.notFound("User");
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { canUploadFiles: allowed },
      select: { id: true, username: true, role: true, canUploadFiles: true },
    });
    await logAdminAction(this.prisma, adminId, allowed ? "USER_UPLOADS_GRANTED" : "USER_UPLOADS_REVOKED", "User", userId);
    return updated;
  }

  async listProducts(cursor?: string) {
    return this.prisma.digitalProduct.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: "desc" },
      include: { creator: { include: { user: { select: { username: true } } } } },
    });
  }

  async listPayments(cursor?: string) {
    return this.prisma.payment.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Reports with what they are about — a name and the page to look at it
   * on, or null when it is gone — and who sent them.
   */
  async listReports(status?: string) {
    const reports = await this.prisma.report.findMany({
      where: status ? { status: status as never } : undefined,
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      include: { reporter: { select: { username: true } } },
    });
    const ids = (types: string[]) => [...new Set(reports.filter((r) => types.includes(r.targetType)).map((r) => r.targetId))];
    const [creators, products, comments] = await Promise.all([
      this.prisma.creatorProfile.findMany({
        where: { id: { in: ids(["CREATOR"]) } },
        select: { id: true, displayName: true, user: { select: { username: true } } },
      }),
      this.prisma.digitalProduct.findMany({
        where: { id: { in: ids(["PRODUCT", "POST", "BUNDLE", "STICKER_PACK"]) } },
        select: { id: true, title: true, creator: { select: { user: { select: { username: true } } } } },
      }),
      this.prisma.comment.findMany({
        where: { id: { in: ids(["COMMENT"]) } },
        select: {
          id: true,
          body: true,
          deletedAt: true,
          user: { select: { username: true } },
          product: { select: { id: true, creator: { select: { user: { select: { username: true } } } } } },
        },
      }),
    ]);
    const byId = new Map<string, { label: string; path: string; author: string }>();
    for (const c of creators) byId.set(c.id, { label: c.displayName, path: `/${c.user.username}`, author: c.user.username });
    for (const p of products) byId.set(p.id, { label: p.title, path: postPathFor(p.creator.user.username, p.id), author: p.creator.user.username });
    for (const c of comments) {
      const body = c.deletedAt ? "" : c.body.replace(/\s+/g, " ").trim();
      byId.set(c.id, {
        label: body.length > 140 ? `${body.slice(0, 140)}…` : body,
        path: `${postPathFor(c.product.creator.user.username, c.product.id)}#comment-${c.id}`,
        author: c.user.username,
      });
    }
    return reports.map(({ reporter, ...report }) => ({
      ...report,
      reporterUsername: reporter?.username ?? null,
      target: byId.get(report.targetId) ?? null,
    }));
  }

  async listInstances() {
    return this.prisma.federationInstance.findMany({ orderBy: { createdAt: "desc" } });
  }

  /**
   * What this server sent other servers for an author — each post and
   * profile update, per follower's inbox, and how it went: newest first, a
   * page at a time, searchable by the inbox's server or the post's title.
   */
  async listDeliveries(username: string, options: { q?: string; status?: string; cursor?: string }) {
    const creator = await this.prisma.creatorProfile.findFirst({ where: { user: { username } }, select: { id: true } });
    if (!creator) throw Errors.notFound("Creator");
    const q = options.q?.trim();
    const status = (["PENDING", "DELIVERED", "FAILED"] as const).find((s) => s === options.status);
    const where: Prisma.FollowerDeliveryWhereInput = {
      OR: [{ creatorId: creator.id }, { product: { creatorId: creator.id } }],
      ...(status ? { status } : {}),
      ...(q
        ? {
            AND: [
              {
                OR: [
                  { inbox: { contains: q, mode: "insensitive" as const } },
                  { product: { title: { contains: q, mode: "insensitive" as const } } },
                  { lastError: { contains: q, mode: "insensitive" as const } },
                ],
              },
            ],
          }
        : {}),
    };
    const page = 100;
    const [rows, counts] = await Promise.all([
      this.prisma.followerDelivery.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: page + 1,
        ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
        select: {
          id: true,
          kind: true,
          inbox: true,
          status: true,
          retryCount: true,
          lastError: true,
          deliveredAt: true,
          createdAt: true,
          product: { select: { id: true, title: true } },
        },
      }),
      this.prisma.followerDelivery.groupBy({
        by: ["status"],
        where: { OR: [{ creatorId: creator.id }, { product: { creatorId: creator.id } }] },
        _count: { _all: true },
      }),
    ]);
    const more = rows.length > page;
    const entries = more ? rows.slice(0, page) : rows;
    return {
      entries,
      nextCursor: more ? entries[entries.length - 1]!.id : null,
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    };
  }

  async suspendUser(adminId: string, userId: string, input: SuspendUserInput) {
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw Errors.notFound("User");
    if (target.role === "ADMIN") throw Errors.validation("Admins cannot be suspended through this action.");

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { suspendedAt: new Date(), suspendedReason: input.reason },
    });
    // Suspension takes effect immediately — revoke every active session.
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await logAdminAction(this.prisma, adminId, "USER_SUSPENDED", "User", userId, { reason: input.reason });
    return updated;
  }

  async restoreUser(adminId: string, userId: string) {
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw Errors.notFound("User");

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { suspendedAt: null, suspendedReason: null },
    });
    await logAdminAction(this.prisma, adminId, "USER_RESTORED", "User", userId);
    return updated;
  }

  async setProductStatus(adminId: string, productId: string, disable: boolean) {
    const product = await this.prisma.digitalProduct.findUnique({ where: { id: productId } });
    if (!product) throw Errors.notFound("Product");

    const updated = await this.prisma.digitalProduct.update({
      where: { id: productId },
      data: { status: disable ? "DISABLED" : "PUBLISHED" },
    });
    await logAdminAction(this.prisma, adminId, disable ? "PRODUCT_DISABLED" : "PRODUCT_ENABLED", "DigitalProduct", productId);
    return updated;
  }

  async resolveReport(adminId: string, reportId: string, input: ResolveReportInput) {
    const report = await this.prisma.report.findUnique({ where: { id: reportId } });
    if (!report) throw Errors.notFound("Report");

    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data: { status: input.status, resolvedById: adminId, resolutionNote: input.note },
    });
    await logAdminAction(this.prisma, adminId, "REPORT_RESOLVED", "Report", reportId, { status: input.status });
    return updated;
  }

  async setInstanceStatus(adminId: string, instanceId: string, input: SetInstanceStatusInput) {
    const instance = await this.prisma.federationInstance.findUnique({ where: { id: instanceId } });
    if (!instance) throw Errors.notFound("Federation instance");

    const updated = await this.prisma.federationInstance.update({
      where: { id: instanceId },
      data: { status: input.status, verified: input.status === "APPROVED" },
    });
    await logAdminAction(this.prisma, adminId, "FEDERATION_INSTANCE_STATUS_CHANGED", "FederationInstance", instanceId, {
      status: input.status,
    });
    return updated;
  }

  /**
   * The log, newest first, with who did each thing. `q` finds an entry by
   * its action, what it was done to (type or id) or the administrator's
   * name — any part of them, any case.
   */
  async listAuditLog(cursor?: string, q?: string) {
    const term = q?.trim().slice(0, 100);
    const rows = await this.prisma.auditLog.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: "desc" },
      where: term
        ? {
            OR: [
              { action: { contains: term.replace(/\s+/g, "_"), mode: "insensitive" } },
              { targetType: { contains: term, mode: "insensitive" } },
              { targetId: { contains: term, mode: "insensitive" } },
              { actor: { username: { contains: term, mode: "insensitive" } } },
            ],
          }
        : undefined,
      include: { actor: { select: { username: true } } },
    });
    return rows.map(({ actor, ...row }) => ({ ...row, actorUsername: actor?.username ?? null }));
  }

  /**
   * Counts for the admin overview. Every number is read from the database
   * at request time — the dashboard shows the platform's actual state, not
   * a cached or estimated figure.
   */
  async stats() {
    const [users, suspended, authors, publishedPosts, confirmedPayments, openReports, unusedInvites] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.count({ where: { deletedAt: null, suspendedAt: { not: null } } }),
      this.prisma.creatorProfile.count(),
      this.prisma.digitalProduct.count({ where: { status: "PUBLISHED", deletedAt: null } }),
      this.prisma.payment.count({ where: { status: "CONFIRMED" } }),
      this.prisma.report.count({ where: { status: "OPEN" } }),
      this.prisma.inviteCode.count({ where: { revokedAt: null, redemptions: { none: {} } } }),
    ]);

    return { users, suspended, authors, publishedPosts, confirmedPayments, openReports, unusedInvites };
  }
}
