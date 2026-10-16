import type { PrismaClient } from "@platform/db";
import { Errors } from "../../lib/errors.js";
import type { CreateReportInput } from "./schemas.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Target = { type: "CREATOR" | "PRODUCT" | "COMMENT"; id: string; ownerId: string };

/**
 * A reader telling the administrators something is wrong with an author,
 * a post or a comment. A report names something that exists and is not
 * the reporter's own; one open report per reporter and target — sending
 * it again changes nothing — and every administrator is told.
 */
export class ReportService {
  constructor(private readonly prisma: PrismaClient) {}

  async file(reporterId: string, input: CreateReportInput) {
    const target = await this.resolve(input.targetType, input.targetId);
    if (!target) throw Errors.notFound("That");
    if (target.ownerId === reporterId) throw Errors.validation("You cannot report your own page, post or comment.");

    const open = await this.prisma.report.findFirst({
      where: { reporterId, targetType: target.type, targetId: target.id, status: { in: ["OPEN", "REVIEWING"] } },
    });
    if (open) return { report: open, created: false };

    const report = await this.prisma.$transaction(async (tx) => {
      const created = await tx.report.create({
        data: { reporterId, targetType: target.type, targetId: target.id, category: input.category, reason: input.reason },
      });
      const admins = await tx.user.findMany({ where: { role: "ADMIN", deletedAt: null, suspendedAt: null }, select: { id: true } });
      if (admins.length) {
        await tx.notification.createMany({
          data: admins.map((admin) => ({
            userId: admin.id,
            type: "REPORT_FILED",
            payload: { reportId: created.id, targetType: target.type, category: input.category },
          })),
        });
      }
      return created;
    });
    return { report, created: true };
  }

  private async resolve(type: CreateReportInput["targetType"], id: string): Promise<Target | null> {
    if (type === "CREATOR") {
      const profile = await this.prisma.creatorProfile.findFirst({
        where: { user: { username: { equals: id, mode: "insensitive" }, deletedAt: null } },
        select: { id: true, userId: true },
      });
      return profile ? { type: "CREATOR", id: profile.id, ownerId: profile.userId } : null;
    }
    if (!UUID.test(id)) return null;
    if (type === "COMMENT") {
      const comment = await this.prisma.comment.findFirst({ where: { id, deletedAt: null }, select: { id: true, userId: true } });
      return comment ? { type: "COMMENT", id: comment.id, ownerId: comment.userId } : null;
    }
    const product = await this.prisma.digitalProduct.findFirst({
      where: { id, deletedAt: null, status: { not: "DRAFT" } },
      select: { id: true, creator: { select: { userId: true } } },
    });
    return product ? { type: "PRODUCT", id: product.id, ownerId: product.creator.userId } : null;
  }
}
