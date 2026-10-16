import type { FastifyInstance } from "fastify";
import { createEmojiSchema } from "./schemas.js";
import { EmojiService } from "./service.js";
import { Errors } from "../../lib/errors.js";

export default async function emojiRoutes(app: FastifyInstance) {
  const service = new EmojiService(app.prisma);

  app.get("/emoji/mine", async (request, reply) => {
    const user = await app.requireAuth(request);
    reply.send({ emoji: await service.listMine(user.id) });
  });

  // Public: without this a reader could not render an author's post text.
  app.get("/emoji/:username", async (request, reply) => {
    const { username } = request.params as { username: string };
    reply.send({ emoji: await service.listForCreator(username) });
  });

  app.post("/emoji", async (request, reply) => {
    const user = await app.requireAuth(request);
    const parsed = createEmojiSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    reply.code(201).send({ emoji: await service.add(user.id, parsed.data) });
  });

  app.delete("/emoji/:id", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    await service.remove(user.id, id);
    reply.send({ ok: true });
  });
}
