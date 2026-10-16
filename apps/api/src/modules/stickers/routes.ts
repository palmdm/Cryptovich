import type { FastifyInstance } from "fastify";
import { setPriceSchema } from "./schemas.js";
import { StickerPackService } from "./service.js";
import { Errors } from "../../lib/errors.js";

export default async function stickerRoutes(app: FastifyInstance) {
  const packs = new StickerPackService(app.prisma);

  app.patch("/products/stickers/:id/price", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    const parsed = setPriceSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    const product = await packs.setPrice(user.id, id, parsed.data);
    reply.send({ product });
  });
}
