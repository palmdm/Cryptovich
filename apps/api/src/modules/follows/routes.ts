import type { FastifyInstance } from "fastify";
import { FollowService } from "./service.js";

export default async function followRoutes(app: FastifyInstance) {
  const service = new FollowService(app.prisma);

  // Public: whether the reader follows (false signed out) and how many do.
  app.get("/creators/:username/follow", async (request, reply) => {
    const { username } = request.params as { username: string };
    reply.send(await service.status(request.currentUser?.id ?? null, username));
  });

  app.post("/creators/:username/follow", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { username } = request.params as { username: string };
    reply.send(await service.follow(user.id, username));
  });

  app.delete("/creators/:username/follow", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { username } = request.params as { username: string };
    reply.send(await service.unfollow(user.id, username));
  });

  app.get("/follows/mine", async (request, reply) => {
    const user = await app.requireAuth(request);
    reply.send({ follows: await service.listMine(user.id) });
  });
}
