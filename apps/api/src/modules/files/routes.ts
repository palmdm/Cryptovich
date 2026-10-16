import type { FastifyInstance } from "fastify";
import { FileService, type FileKind } from "./service.js";

const KINDS: FileKind[] = ["image", "video", "audio", "other"];

/** An author's own stored files: the files section of the dashboard. */
export default async function fileRoutes(app: FastifyInstance) {
  const service = new FileService(app.prisma);

  app.get("/files/mine", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { q, kind } = request.query as { q?: string; kind?: string };
    const files = await service.list(user.id, {
      q: typeof q === "string" ? q.slice(0, 200) : undefined,
      kind: KINDS.includes(kind as FileKind) ? (kind as FileKind) : undefined,
    });
    reply.send({ files });
  });

  app.delete("/files/mine/:source/:id", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { source, id } = request.params as { source: string; id: string };
    await service.remove(user.id, source, id);
    reply.send({ ok: true });
  });
}
