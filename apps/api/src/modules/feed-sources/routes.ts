import type { FastifyInstance } from "fastify";
import { createFeedSourceSchema } from "./schemas.js";
import { FeedSourceService } from "./service.js";
import { Errors } from "../../lib/errors.js";

export default async function feedSourceRoutes(app: FastifyInstance) {
  const service = new FeedSourceService(app.prisma);

  app.post("/feed-sources", async (request, reply) => {
    const user = await app.requireAuth(request);
    const parsed = createFeedSourceSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    const source = await service.create(user.id, parsed.data);
    reply.code(201).send({ feedSource: source });
  });

  app.get("/feed-sources/mine", async (request, reply) => {
    const user = await app.requireAuth(request);
    reply.send({ feedSources: await service.listMine(user.id) });
  });

  app.delete("/feed-sources/:id/posts", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    reply.send({ removed: await service.removeImportedPosts(user.id, id) });
  });

  app.delete("/feed-sources/:id", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    await service.remove(user.id, id);
    reply.send({ ok: true });
  });
}
