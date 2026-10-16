import type { FastifyInstance } from "fastify";
import { createCommentSchema } from "./schemas.js";
import { CommentService } from "./service.js";
import { Errors } from "../../lib/errors.js";

export default async function commentRoutes(app: FastifyInstance) {
  const service = new CommentService(app.prisma);

  app.post("/products/:id/comments", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    const parsed = createCommentSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    const comment = await service.create(user.id, id, parsed.data);
    reply.code(201).send({ comment });
  });

  app.get("/products/:id/comments", async (request, reply) => {
    const { id } = request.params as { id: string };
    const comments = await service.list(request.currentUser?.id ?? null, id);
    reply.send({ comments });
  });

  app.delete("/comments/:id", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    await service.remove(user.id, id);
    reply.send({ ok: true });
  });
}
