import type { FastifyInstance } from "fastify";
import { createWalletSchema } from "./schemas.js";
import { WalletService } from "./service.js";
import { Errors } from "../../lib/errors.js";

export default async function walletRoutes(app: FastifyInstance) {
  const service = new WalletService(app.prisma);

  app.get("/wallets/mine", async (request, reply) => {
    const user = await app.requireAuth(request);
    reply.send({ wallets: await service.listMine(user.id) });
  });

  // Public: a supporter needs to see where to send money before they pay.
  app.get("/wallets/:username", async (request, reply) => {
    const { username } = request.params as { username: string };
    reply.send({ wallets: await service.listForCreator(username) });
  });

  app.post("/wallets", async (request, reply) => {
    const user = await app.requireAuth(request);
    const parsed = createWalletSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    reply.code(201).send({ wallet: await service.add(user.id, parsed.data) });
  });

  app.delete("/wallets/:id", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    await service.remove(user.id, id);
    reply.send({ ok: true });
  });
}
