import type { FastifyInstance } from "fastify";
import { FeedService } from "./service.js";

export default async function feedRoutes(app: FastifyInstance) {
  const service = new FeedService(app.prisma);

  // Auth-only by nature: the whole point is "the authors *you* follow".
  app.get("/feed", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { limit, cursor } = request.query as { limit?: string; cursor?: string };
    reply.send(
      await service.forUser(user.id, {
        limit: limit ? Number(limit) : undefined,
        cursor: cursor || undefined,
      }),
    );
  });

  // The posts the reader saved. A list of their own, so it is auth-only
  // and never cached by anything shared.
  app.get("/bookmarks", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { limit, cursor } = request.query as { limit?: string; cursor?: string };
    reply.send(
      await service.bookmarks(user.id, {
        limit: limit ? Number(limit) : undefined,
        cursor: cursor || undefined,
      }),
    );
  });
}
