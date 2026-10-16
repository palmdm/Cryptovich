import type { FastifyInstance } from "fastify";
import { adminRewardSchema, sendRewardSchema } from "./schemas.js";
import { RewardService } from "./service.js";
import { Errors } from "../../lib/errors.js";

export default async function rewardRoutes(app: FastifyInstance) {
  const service = new RewardService(app.prisma);

  // Public: what can be given.
  app.get("/rewards", async (_request, reply) => {
    reply.send({ rewards: await service.catalog() });
  });

  // A reward on its own. Free ones need an account; a paid one, like a
  // tip, does not — the payment id is the payer's way back to it.
  app.post("/rewards/send", async (request, reply) => {
    const parsed = sendRewardSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    reply.code(201).send(await service.send(request.currentUser?.id ?? null, parsed.data));
  });

  // Public, like the profile it decorates: what an author holds, never who gave it.
  app.get("/rewards/creator/:username", async (request, reply) => {
    const { username } = request.params as { username: string };
    reply.send({ rewards: await service.forCreator(username) });
  });

  app.get("/rewards/received", async (request, reply) => {
    const user = await app.requireAuth(request);
    reply.send(await service.received(user.id));
  });

  // The reward stickers the caller may react with.
  app.get("/rewards/owned", async (request, reply) => {
    const user = await app.requireAuth(request);
    reply.send({ shortcodes: await service.ownedShortcodes(user.id) });
  });

  app.get("/admin/rewards", async (request, reply) => {
    await app.requireAdmin(request);
    reply.send({ rewards: await service.adminList() });
  });

  app.put("/admin/rewards/:emojiId", async (request, reply) => {
    const admin = await app.requireAdmin(request);
    const { emojiId } = request.params as { emojiId: string };
    const parsed = adminRewardSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    reply.send({ reward: await service.adminUpsert(admin.id, emojiId, parsed.data) });
  });

  app.delete("/admin/rewards/:emojiId", async (request, reply) => {
    const admin = await app.requireAdmin(request);
    const { emojiId } = request.params as { emojiId: string };
    await service.adminRemove(admin.id, emojiId);
    reply.send({ ok: true });
  });
}
