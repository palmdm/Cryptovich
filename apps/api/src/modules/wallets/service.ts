import type { PrismaClient } from "@platform/db";
import { Errors } from "../../lib/errors.js";
import type { CreateWalletInput } from "./schemas.js";

/**
 * Addresses an author publishes so supporters can pay them directly. The
 * platform is non-custodial and never watches a chain: it stores the
 * address, shows it to the payer, and the author confirms receipt
 * themselves. Nothing here implies the platform can verify a transfer.
 */
export class WalletService {
  constructor(private readonly prisma: PrismaClient) {}

  async listMine(userId: string) {
    return this.prisma.wallet.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
  }

  /** Public: what a supporter is shown at checkout. */
  async listForCreator(username: string) {
    const user = await this.prisma.user.findFirst({
      where: { username, deletedAt: null },
      select: { id: true, creatorProfile: { select: { id: true } } },
    });
    if (!user?.creatorProfile) return [];
    const wallets = await this.prisma.wallet.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });
    return wallets.map((w) => ({ id: w.id, network: w.network, address: w.address, label: w.label }));
  }

  async add(userId: string, input: CreateWalletInput) {
    const existing = await this.prisma.wallet.findUnique({
      where: { userId_network_address: { userId, network: input.network, address: input.address } },
    });
    if (existing) throw Errors.validation("You've already added that address.");

    return this.prisma.wallet.create({
      data: { userId, network: input.network, address: input.address, label: input.label },
    });
  }

  async remove(userId: string, id: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { id } });
    if (!wallet || wallet.userId !== userId) throw Errors.notFound("Address");
    await this.prisma.wallet.delete({ where: { id } });
  }
}
