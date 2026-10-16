import type { PrismaClient } from "@platform/db";
import { Money } from "@platform/shared";
import { Errors } from "../../lib/errors.js";
import { SettingsService } from "../settings/service.js";
import { createApiToken } from "../../lib/api-token.js";
import { withScopeLock } from "../../lib/scope-lock.js";
import { NotificationService } from "../notifications/service.js";
import type { RequestApiAccessInput, ReviewApiAccessInput } from "./schemas.js";

/**
 * Programmatic API access is registered, contributed-for, and approved by
 * a person. The contribution is sent to the administrator directly — the
 * platform never holds funds — so approval is the administrator saying
 * "I received this", exactly like every other payment here.
 *
 * Approving mints the token. There is no route that mints one without an
 * approval, which is the whole point: a self-serve key would make the
 * contribution optional.
 */
export class ApiAccessService {
  private readonly notifications: NotificationService;

  constructor(private readonly prisma: PrismaClient) {
    this.notifications = new NotificationService(prisma);
  }

  /** What the requester sees: their own request, and whether it produced a key. */
  async mine(userId: string) {
    const request = await this.prisma.apiAccessRequest.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: { apiToken: { select: { id: true, name: true, revokedAt: true, lastUsedAt: true } } },
    });
    if (!request) return null;
    return {
      id: request.id,
      status: request.status,
      amountMinor: request.amountMinor.toString(),
      currency: request.currency,
      note: request.note,
      reviewNote: request.reviewNote,
      createdAt: request.createdAt,
      reviewedAt: request.reviewedAt,
      // The key itself is shown once, at approval, and never again.
      hasKey: Boolean(request.apiToken && !request.apiToken.revokedAt),
    };
  }

  async request(userId: string, input: RequestApiAccessInput) {
    // Nothing to request: the operator has made keys self-serve, and the
    // account can mint one directly.
    if (await new SettingsService(this.prisma).isApiAccessFree()) {
      throw Errors.validation("API keys are free on this server — create one from your dashboard.");
    }

    const money = Money.fromDecimalString(input.amountDecimal, "USD");

    // One open request at a time, or a queue fills with duplicates of the
    // same person and the administrator cannot tell them apart.
    return withScopeLock(this.prisma, `api-access:${userId}`, async (tx) => {
      const open = await tx.apiAccessRequest.findFirst({
        where: { userId, status: { in: ["REQUESTED", "APPROVED"] } },
      });
      if (open) {
        throw Errors.validation(
          open.status === "APPROVED"
            ? "You already have API access."
            : "You already have a request waiting for review.",
        );
      }

      return tx.apiAccessRequest.create({
        data: { userId, amountMinor: money.amountMinor, currency: "USD", note: input.note },
      });
    });
  }

  async list(status?: string) {
    const requests = await this.prisma.apiAccessRequest.findMany({
      where: status ? { status: status as never } : {},
      include: {
        user: { select: { id: true, username: true, email: true, role: true, canUploadFiles: true } },
        reviewedBy: { select: { username: true } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 200,
    });

    return requests.map((r) => ({
      id: r.id,
      status: r.status,
      amountMinor: r.amountMinor.toString(),
      currency: r.currency,
      note: r.note,
      reviewNote: r.reviewNote,
      createdAt: r.createdAt,
      reviewedAt: r.reviewedAt,
      reviewedBy: r.reviewedBy?.username ?? null,
      user: r.user,
    }));
  }

  /**
   * The administrator confirming they received the contribution. Approval
   * mints the token and returns it exactly once — it is never recoverable
   * afterwards, so the caller has to show it to the requester now.
   */
  async review(adminId: string, requestId: string, input: ReviewApiAccessInput) {
    const request = await this.prisma.apiAccessRequest.findUnique({ where: { id: requestId } });
    if (!request) throw Errors.notFound("Request");
    if (request.status !== "REQUESTED") {
      throw Errors.validation("That request has already been reviewed.");
    }

    if (input.decision === "REJECTED") {
      const updated = await this.prisma.apiAccessRequest.update({
        where: { id: requestId },
        data: { status: "REJECTED", reviewedById: adminId, reviewedAt: new Date(), reviewNote: input.reviewNote },
      });
      // A decision the requester is never told about is the same as no
      // decision — they would keep waiting on a queue they left.
      await this.notifications.notify(request.userId, "API_ACCESS_REJECTED", {
        reviewNote: input.reviewNote ?? null,
      });
      return { request: updated, token: null };
    }

    const minted = await createApiToken(this.prisma, request.userId, "API access");
    const updated = await this.prisma.apiAccessRequest.update({
      where: { id: requestId },
      data: {
        status: "APPROVED",
        reviewedById: adminId,
        reviewedAt: new Date(),
        reviewNote: input.reviewNote,
        apiTokenId: minted.id,
      },
    });

    // Approval also pays for server-side storage, so it carries the
    // upload privilege with it rather than needing a second contribution.
    await this.prisma.user.update({ where: { id: request.userId }, data: { canUploadFiles: true } });
    await this.notifications.notify(request.userId, "API_ACCESS_APPROVED", {
      reviewNote: input.reviewNote ?? null,
    });

    return { request: updated, token: minted.token };
  }

  /** Withdrawing access: revokes the key and the upload privilege together. */
  async revoke(adminId: string, requestId: string) {
    const request = await this.prisma.apiAccessRequest.findUnique({ where: { id: requestId } });
    if (!request) throw Errors.notFound("Request");
    if (request.status !== "APPROVED") throw Errors.validation("That request isn't approved.");

    if (request.apiTokenId) {
      await this.prisma.apiToken.update({
        where: { id: request.apiTokenId },
        data: { revokedAt: new Date() },
      });
    }
    await this.prisma.user.update({ where: { id: request.userId }, data: { canUploadFiles: false } });

    // Their key stops working on the next request, so being told is the
    // difference between "revoked" and "mysteriously broken".
    await this.notifications.notify(request.userId, "API_ACCESS_REVOKED", undefined);

    return this.prisma.apiAccessRequest.update({
      where: { id: requestId },
      data: { status: "REVOKED", reviewedById: adminId, reviewedAt: new Date() },
    });
  }
}
