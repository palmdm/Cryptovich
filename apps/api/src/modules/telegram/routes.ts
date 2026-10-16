import type { FastifyInstance } from "fastify";
import { Errors } from "../../lib/errors.js";
import { isInternalToken } from "../../lib/internal-token.js";
import { ProductService } from "../products/service.js";
import { AttachmentService } from "../products/attachment-service.js";
import { telegramPublishSchema, updateTelegramSchema } from "./schemas.js";
import { TelegramService } from "./service.js";

export default async function telegramRoutes(app: FastifyInstance) {
  const service = new TelegramService(app.prisma, app.redis);
  const products = new ProductService(app.prisma);
  const attachments = new AttachmentService(app.prisma);

  app.get("/telegram/me", async (request, reply) => {
    const user = await app.requireAuth(request);
    reply.send(await service.status(user.id));
  });

  app.post("/telegram/link", async (request, reply) => {
    const user = await app.requireAuth(request);
    reply.send(await service.linkCode(user.id));
  });

  app.patch("/telegram/me", async (request, reply) => {
    const user = await app.requireAuth(request);
    const parsed = updateTelegramSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    reply.send(await service.update(user.id, parsed.data));
  });

  app.delete("/telegram/me", async (request, reply) => {
    const user = await app.requireAuth(request);
    await service.unlink(user.id);
    reply.send({ ok: true });
  });

  // The worker, handing over a post an author wrote to the bot. Not a
  // public route: it answers only the worker's own secret.
  app.post("/internal/telegram/posts", { schema: { hide: true } }, async (request, reply) => {
    if (!(await isInternalToken(app.prisma, request.headers["x-internal-token"] as string | undefined))) throw Errors.forbidden();
    const parsed = telegramPublishSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    const result = await service.publishFromChat(parsed.data, {
      createPost: (userId, data) => products.createPost(userId, { ...data, currency: "USD", priceDecimal: "0" }),
      attach: (userId, productId, file) => attachments.upload(userId, productId, file),
      publish: (userId, productId) => products.publish(userId, productId),
    });
    reply.code(201).send(result);
  });
}
