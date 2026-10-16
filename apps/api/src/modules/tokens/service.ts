import type { PrismaClient } from "@platform/db";
import { Errors } from "../../lib/errors.js";
import { createApiToken } from "../../lib/api-token.js";
import type { CreateTokenInput } from "./schemas.js";

export class TokenService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Returns the raw token exactly once — the caller (route) must show it
   * to the user now, because it's never recoverable after this call. */
  async create(userId: string, input: CreateTokenInput) {
    return createApiToken(this.prisma, userId, input.name);
  }

  async listMine(userId: string) {
    return this.prisma.apiToken.findMany({
      where: { userId, revokedAt: null },
      select: { id: true, name: true, lastUsedAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async revoke(userId: string, id: string) {
    const token = await this.prisma.apiToken.findUnique({ where: { id } });
    if (!token || token.userId !== userId) throw Errors.notFound("Token");
    await this.prisma.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
  }
}
