import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Errors } from "../../lib/errors.js";
import { AnnouncementService, announcementInputSchema } from "./service.js";

export default async function announcementRoutes(app: FastifyInstance) {
  const service = new AnnouncementService(app.prisma);

  // Public: a first-time visitor sees them before signing in.
  app.get("/announcements", async (request, reply) => {
    reply.send({ announcements: await service.listActive(request.currentUser?.id ?? null) });
  });

  app.post("/announcements/:id/reactions", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    const parsed = z.object({ emoji: z.string() }).safeParse(request.body);
    if (!parsed.success) throw Errors.validation("An emoji is required.");
    reply.send({ announcement: await service.toggleReaction(user.id, id, parsed.data.emoji) });
  });

  app.get("/admin/announcements", async (request, reply) => {
    await app.requireAdmin(request);
    reply.send({ announcements: await service.listAll() });
  });

  app.post("/admin/announcements", async (request, reply) => {
    const admin = await app.requireAdmin(request);
    const parsed = announcementInputSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid announcement.");
    reply.code(201).send({ announcement: await service.create(admin.id, parsed.data) });
  });

  app.patch("/admin/announcements/:id", async (request, reply) => {
    const admin = await app.requireAdmin(request);
    const { id } = request.params as { id: string };
    const parsed = announcementInputSchema.partial().safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid announcement.");
    reply.send({ announcement: await service.update(admin.id, id, parsed.data) });
  });

  app.delete("/admin/announcements/:id", async (request, reply) => {
    const admin = await app.requireAdmin(request);
    const { id } = request.params as { id: string };
    await service.remove(admin.id, id);
    reply.send({ ok: true });
  });
}
