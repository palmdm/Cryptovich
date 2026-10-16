import type { FastifyInstance } from "fastify";
import { Errors } from "../../lib/errors.js";
import { createShortLinkSchema } from "./schemas.js";
import { ShortLinkService } from "./service.js";

export default async function shortLinkRoutes(app: FastifyInstance) {
  const service = new ShortLinkService(app.prisma);

  // The short address itself — reached at the site's root (/s/<code>, the
  // web app forwards it here). Never cached: each use is counted.
  app.get("/s/:code", async (request, reply) => {
    const { code } = request.params as { code: string };
    const target = await service.follow(code, {
      userId: request.currentUser?.id ?? null,
      referer: request.headers.referer,
      query: request.query as Record<string, string | string[] | undefined>,
    });
    if (!target) throw Errors.notFound("Link");
    reply.header("Cache-Control", "no-store").redirect(target, 302);
  });

  app.post("/short-links", async (request, reply) => {
    const user = await app.requireAuth(request);
    const parsed = createShortLinkSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    reply.code(201).send({ link: await service.create(user.id, parsed.data) });
  });

  app.get("/short-links/mine", async (request, reply) => {
    const user = await app.requireAuth(request);
    reply.send({ links: await service.listMine(user.id) });
  });

  app.get("/short-links/personal", async (request, reply) => {
    const user = await app.requireAuth(request);
    reply.send({ groups: await service.personalSummary(user.id) });
  });

  app.get("/short-links/:id/stats", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    reply.send(await service.stats(user.id, id));
  });

  app.delete("/short-links/:id", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    await service.remove(user.id, id);
    reply.send({ ok: true });
  });
}
