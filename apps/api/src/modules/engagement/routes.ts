import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { EngagementService } from "./service.js";
import { Errors } from "../../lib/errors.js";

export default async function engagementRoutes(app: FastifyInstance) {
  const service = new EngagementService(app.prisma);

  // A fire-and-forget beacon from a feed that rendered this post's card.
  // Optional-auth so anonymous reading still counts, and deliberately
  // always 204 — a listing must not surface an error for a counter.
  // One call for a whole listing — see `recordImpressions`.
  app.post("/products/impressions", async (request, reply) => {
    const parsed = z.object({ productIds: z.array(z.string().uuid()).max(200) }).safeParse(request.body);
    if (!parsed.success) throw Errors.validation("`productIds` must be a list of post ids.");
    const counted = await service.recordImpressions(parsed.data.productIds, request.currentUser?.id ?? null);
    reply.send({ counted });
  });

  app.post("/products/:id/impression", async (request, reply) => {
    const { id } = request.params as { id: string };
    await service.recordImpression(id, request.currentUser?.id ?? null);
    reply.code(204).send();
  });

  app.post("/products/:id/bookmark", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    reply.send(await service.toggleBookmark(user.id, id));
  });

  app.get("/products/:id/stats", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    reply.send({ stats: await service.statsForOwner(user.id, id) });
  });
}
