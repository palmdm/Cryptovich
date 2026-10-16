import type { FastifyInstance } from "fastify";
import { createInviteSchema, createOwnInviteSchema } from "./schemas.js";
import { InviteService, MEMBER_INVITE_LIMITS } from "./service.js";
import { Errors } from "../../lib/errors.js";

export default async function inviteRoutes(app: FastifyInstance) {
  const service = new InviteService(app.prisma);

  // Every account may bring others in. Its own codes only: an
  // administrator's list above is the whole ledger.
  app.get("/invites", async (request, reply) => {
    const user = await app.requireAuth(request);
    reply.send({ invites: await service.listForUser(user.id), limits: MEMBER_INVITE_LIMITS });
  });

  app.post("/invites", async (request, reply) => {
    const user = await app.requireAuth(request);
    const parsed = createOwnInviteSchema.safeParse(request.body ?? {});
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    reply.code(201).send({ invite: await service.createForUser(user.id, parsed.data) });
  });

  app.post("/invites/:id/revoke", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    await service.revokeOwn(user.id, id);
    reply.send({ ok: true });
  });

  // Public, like the profile it decorates: who invited this account.
  app.get("/users/:username/invited-by", async (request, reply) => {
    const { username } = request.params as { username: string };
    reply.send({ invitedBy: await service.inviterOf(username.toLowerCase()) });
  });

  app.get("/admin/invites", async (request, reply) => {
    await app.requireAdmin(request);
    reply.send({ invites: await service.list() });
  });

  app.post("/admin/invites", async (request, reply) => {
    const admin = await app.requireAdmin(request);
    const parsed = createInviteSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    const invite = await service.create(admin.id, parsed.data);
    reply.code(201).send({ invite });
  });

  app.post("/admin/invites/:id/revoke", async (request, reply) => {
    await app.requireAdmin(request);
    const { id } = request.params as { id: string };
    await service.revoke(id);
    reply.send({ ok: true });
  });
}
