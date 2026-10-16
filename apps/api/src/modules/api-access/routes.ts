import type { FastifyInstance } from "fastify";
import { requestApiAccessSchema, reviewApiAccessSchema } from "./schemas.js";
import { ApiAccessService } from "./service.js";
import { Errors } from "../../lib/errors.js";
import { API_ACCESS_MIN_MINOR, API_ACCESS_MAX_MINOR } from "@platform/shared";

export default async function apiAccessRoutes(app: FastifyInstance) {
  const service = new ApiAccessService(app.prisma);

  // What to send and where. Session-only: this is the page a registered
  // user reads before contributing, and there is nothing here worth
  // exposing to an anonymous caller.
  app.get("/api-access/terms", async (request, reply) => {
    await app.requireAuth(request);
    const admin = await app.prisma.user.findFirst({
      where: { role: "ADMIN", deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { username: true, email: true },
    });
    const wallets = admin
      ? await app.prisma.wallet.findMany({
          where: { user: { username: admin.username } },
          select: { network: true, address: true, label: true },
        })
      : [];

    reply.send({
      minMinor: API_ACCESS_MIN_MINOR.toString(),
      maxMinor: API_ACCESS_MAX_MINOR.toString(),
      currency: "USD",
      admin: admin ? { username: admin.username, email: admin.email } : null,
      wallets,
    });
  });

  app.get("/api-access/mine", async (request, reply) => {
    const user = await app.requireAuth(request);
    reply.send({ request: await service.mine(user.id) });
  });

  app.post("/api-access/requests", async (request, reply) => {
    const user = await app.requireAuth(request);
    const parsed = requestApiAccessSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    reply.code(201).send({ request: await service.request(user.id, parsed.data) });
  });

  app.get("/admin/api-access", async (request, reply) => {
    await app.requireAdmin(request);
    const { status } = request.query as { status?: string };
    reply.send({ requests: await service.list(status) });
  });

  app.post("/admin/api-access/:id/review", async (request, reply) => {
    const admin = await app.requireAdmin(request);
    const { id } = request.params as { id: string };
    const parsed = reviewApiAccessSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    const result = await service.review(admin.id, id, parsed.data);
    // The minted key crosses the wire exactly once, here.
    reply.send({ request: result.request, token: result.token });
  });

  app.post("/admin/api-access/:id/revoke", async (request, reply) => {
    const admin = await app.requireAdmin(request);
    const { id } = request.params as { id: string };
    reply.send({ request: await service.revoke(admin.id, id) });
  });
}
