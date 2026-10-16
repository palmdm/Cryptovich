import type { FastifyInstance } from "fastify";
import { createBundleSchema, updateBundleSchema, addItemSchema, reorderSchema } from "./schemas.js";
import { BundleService } from "./service.js";
import { Errors } from "../../lib/errors.js";

export default async function bundleRoutes(app: FastifyInstance) {
  const service = new BundleService(app.prisma);

  app.post("/products/bundles", async (request, reply) => {
    const user = await app.requireAuth(request);
    const parsed = createBundleSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    const bundle = await service.create(user.id, parsed.data);
    reply.code(201).send({ product: bundle });
  });

  app.patch("/products/bundles/:id", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    const parsed = updateBundleSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    const bundle = await service.update(user.id, id, parsed.data);
    reply.send({ product: bundle });
  });

  app.post("/products/bundles/:id/items", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    const parsed = addItemSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation("A valid product is required.");
    const item = await service.addItem(user.id, id, parsed.data.itemProductId);
    reply.code(201).send({ item });
  });

  app.delete("/products/bundles/:id/items/:itemProductId", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id, itemProductId } = request.params as { id: string; itemProductId: string };
    await service.removeItem(user.id, id, itemProductId);
    reply.send({ ok: true });
  });

  app.put("/products/bundles/:id/items/order", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    const parsed = reorderSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation("A valid item order is required.");
    await service.reorder(user.id, id, parsed.data.itemProductIds);
    reply.send({ ok: true });
  });

  app.get("/products/bundles/:id/detail", async (request, reply) => {
    const { id } = request.params as { id: string };
    const detail = await service.getDetail(id, request.currentUser?.id ?? null);
    reply.send(detail);
  });
}
