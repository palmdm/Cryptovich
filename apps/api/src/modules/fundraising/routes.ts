import type { FastifyInstance } from "fastify";
import { createGoalSchema, updateGoalSchema } from "./schemas.js";
import { FundraisingService } from "./service.js";
import { Errors } from "../../lib/errors.js";

export default async function fundraisingRoutes(app: FastifyInstance) {
  const service = new FundraisingService(app.prisma);

  // Public — a fundraising bar is only useful if readers can see it.
  app.get("/fundraising/:username", async (request, reply) => {
    const { username } = request.params as { username: string };
    reply.send(await service.listForCreator(username));
  });

  app.get("/fundraising/mine/all", async (request, reply) => {
    const user = await app.requireAuth(request);
    reply.send({ goals: await service.listMine(user.id) });
  });

  app.post("/fundraising", async (request, reply) => {
    const user = await app.requireAuth(request);
    const parsed = createGoalSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    reply.code(201).send({ goal: await service.create(user.id, parsed.data) });
  });

  app.patch("/fundraising/:id", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    const parsed = updateGoalSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    reply.send({ goal: await service.update(user.id, id, parsed.data) });
  });

  app.delete("/fundraising/:id", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    await service.remove(user.id, id);
    reply.send({ ok: true });
  });
}
