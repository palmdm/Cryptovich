import type { FastifyInstance } from "fastify";
import { EntitlementService } from "../entitlements/service.js";

export default async function libraryRoutes(app: FastifyInstance) {
  const service = new EntitlementService(app.prisma);

  app.get("/library", async (request, reply) => {
    const user = await app.requireAuth(request);
    const entitlements = await service.listOwned(user.id);
    reply.send({
      items: entitlements.map((e) => ({
        entitlementId: e.id,
        sourceType: e.sourceType,
        grantedAt: e.createdAt,
        product: e.product,
      })),
    });
  });
}
