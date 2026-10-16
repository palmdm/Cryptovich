import type { FastifyInstance, FastifyRequest } from "fastify";
import { Errors } from "../../lib/errors.js";
import { logAdminAction } from "../../lib/audit-log.js";
import { applyUpdateSchema } from "./schemas.js";
import { UpdateService } from "./service.js";

export default async function updateRoutes(app: FastifyInstance) {
  const service = new UpdateService(app.redis);

  // The check is the administrators' (it reaches out to GitHub).
  app.get("/admin/updates", async (request, reply) => {
    await app.requireAdmin(request);
    const { refresh } = request.query as { refresh?: string };
    reply.header("Cache-Control", "no-store").send(await service.overview(refresh === "1"));
  });

  app.get("/admin/updates/status", async (request, reply) => {
    await app.requireAdmin(request);
    reply.header("Cache-Control", "no-store").send({ status: await service.status() });
  });

  /**
   * Installing: a browser session with a fresh second factor (the same
   * ten-minute unlock as "Редактирование параметров"), never a token.
   */
  async function unlockedAdmin(request: FastifyRequest) {
    const admin = await app.requireAdmin(request);
    if (request.headers.authorization || !request.currentSession) throw Errors.forbidden();
    if (!(await app.redis.get(`parameters-unlock:${request.currentSession.id}`))) throw Errors.parametersLocked();
    return admin;
  }

  app.post("/admin/updates/apply", { schema: { hide: true } }, async (request, reply) => {
    const admin = await unlockedAdmin(request);
    const parsed = applyUpdateSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation("Give the version to install.");
    const queued = await service.request(parsed.data.version, admin.username);
    await logAdminAction(app.prisma, admin.id, "UPDATE_REQUESTED", "Server", parsed.data.version, { from: queued.zipUrl });
    reply.code(202).send({ queued: true, version: queued.version });
  });
}
