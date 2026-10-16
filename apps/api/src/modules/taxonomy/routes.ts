import type { FastifyInstance } from "fastify";
import {
  createCategorySchema,
  updateCategorySchema,
  setProductCategoriesSchema,
  setProductTagsSchema,
} from "./schemas.js";
import { TaxonomyService } from "./service.js";
import { Errors } from "../../lib/errors.js";

export default async function taxonomyRoutes(app: FastifyInstance) {
  const service = new TaxonomyService(app.prisma);

  app.get("/categories/mine", async (request, reply) => {
    const user = await app.requireAuth(request);
    reply.send({ categories: await service.listMyCategories(user.id) });
  });

  // Public: the sections a reader can filter an author's page by.
  app.get("/categories/:username", async (request, reply) => {
    const { username } = request.params as { username: string };
    reply.send({ categories: await service.listCategoriesFor(username) });
  });

  app.post("/categories", async (request, reply) => {
    const user = await app.requireAuth(request);
    const parsed = createCategorySchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    reply.code(201).send({ category: await service.createCategory(user.id, parsed.data) });
  });

  app.patch("/categories/:id", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    const parsed = updateCategorySchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    reply.send({ category: await service.updateCategory(user.id, id, parsed.data) });
  });

  app.delete("/categories/:id", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    await service.deleteCategory(user.id, id);
    reply.send({ ok: true });
  });

  app.put("/products/:id/categories", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    const parsed = setProductCategoriesSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    reply.send(await service.setProductCategories(user.id, id, parsed.data.categoryIds));
  });

  app.put("/products/:id/tags", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    const parsed = setProductTagsSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    reply.send(await service.setProductTags(user.id, id, parsed.data.tags));
  });
}
