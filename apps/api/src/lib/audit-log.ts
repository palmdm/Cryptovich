import type { PrismaClient, Prisma } from "@platform/db";

/** Every admin/moderation action is recorded here (spec rule #86) — never with secrets in `metadata`. */
export async function logAdminAction(
  prisma: PrismaClient,
  actorUserId: string,
  action: string,
  targetType: string,
  targetId: string,
  metadata?: Prisma.InputJsonValue,
): Promise<void> {
  await prisma.auditLog.create({ data: { actorUserId, action, targetType, targetId, metadata } });
}
