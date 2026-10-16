import type { FastifyInstance } from "fastify";
import { NotificationService } from "./service.js";

export default async function notificationRoutes(app: FastifyInstance) {
  const service = new NotificationService(app.prisma);

  app.get("/notifications", async (request, reply) => {
    const user = await app.requireAuth(request);
    reply.send(await service.list(user.id));
  });

  // What the header's badge and the new-notification sound need, asked
  // every half-minute by an open page: two counts, not the list.
  app.get("/notifications/unread", async (request, reply) => {
    const user = await app.requireAuth(request);
    reply.header("Cache-Control", "no-store").send(await service.unread(user.id));
  });

  app.post("/notifications/:id/read", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    const notification = await service.markRead(user.id, id);
    reply.send({ notification });
  });

  app.post("/notifications/read-all", async (request, reply) => {
    const user = await app.requireAuth(request);
    await service.markAllRead(user.id);
    reply.send({ ok: true });
  });
}
