import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Errors } from "../../lib/errors.js";
import { PushService, subscribeSchema } from "./service.js";

/** Browser push: the key a browser subscribes with, and the subscription itself. */
export default async function pushRoutes(app: FastifyInstance) {
  const service = new PushService(app.prisma);

  // Public: a browser needs it before anything else, and it is public by
  // nature — it is how the browser checks a message came from here.
  app.get("/push/public-key", async (_request, reply) => {
    reply.send({ publicKey: await service.publicKey() });
  });

  app.post("/push/subscriptions", async (request, reply) => {
    const user = await app.requireAuth(request);
    const parsed = subscribeSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid subscription.");
    await service.subscribe(user.id, parsed.data, request.headers["user-agent"]);
    reply.code(201).send({ ok: true });
  });

  app.delete("/push/subscriptions", async (request, reply) => {
    const user = await app.requireAuth(request);
    const parsed = z.object({ endpoint: z.string().max(1000) }).safeParse(request.body);
    if (!parsed.success) throw Errors.validation("An endpoint is required.");
    await service.unsubscribe(user.id, parsed.data.endpoint);
    reply.send({ ok: true });
  });
}
