import type { FastifyInstance } from "fastify";
import { SearchService } from "./service.js";

export default async function searchRoutes(app: FastifyInstance) {
  const service = new SearchService(app.prisma);

  /**
   * Public, like the rest of reading. A signed-in reader gets the same
   * results with more of them opened: the entitlement check decides which
   * posts carry their text, never which posts appear.
   */
  app.get("/search", async (request, reply) => {
    const { q } = request.query as { q?: string };
    reply.send(await service.search(q ?? "", request.currentUser?.id ?? null));
  });
}
