import type { FastifyInstance } from "fastify";
import { suspendUserSchema, resolveReportSchema, setInstanceStatusSchema } from "./schemas.js";
import { AdminService } from "./service.js";
import { SettingsService, SERVER_SETTINGS, type ServerSettingKey } from "../settings/service.js";
import { FederationSettingsService } from "../federation/service.js";
import { updateSettingsSchema } from "../federation/schemas.js";
import { Errors } from "../../lib/errors.js";

export default async function adminRoutes(app: FastifyInstance) {
  const service = new AdminService(app.prisma);
  const settings = new SettingsService(app.prisma);
  const federationSettings = new FederationSettingsService(app.prisma);

  // The operator's own switches. Read by the features they govern; only
  // an administrator can see or change them.
  app.get("/admin/settings", async (request, reply) => {
    await app.requireAdmin(request);
    reply.send({ settings: await settings.all(), options: SERVER_SETTINGS });
  });

  app.patch("/admin/settings", async (request, reply) => {
    await app.requireAdmin(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const entries = Object.entries(body);
    if (entries.length === 0) throw Errors.validation("Nothing to change.");

    for (const [key, value] of entries) {
      const definition = SERVER_SETTINGS[key as ServerSettingKey];
      if (!definition) throw Errors.validation(`Unknown setting: ${key}`);
      if (typeof value !== "string" || !(definition.values as readonly string[]).includes(value)) {
        throw Errors.validation(`${key} must be one of: ${definition.values.join(", ")}`);
      }
    }

    let current = await settings.all();
    for (const [key, value] of entries) current = await settings.set(key as ServerSettingKey, value as string);
    reply.send({ settings: current });
  });

  app.get("/admin/stats", async (request, reply) => {
    await app.requireAdmin(request);
    reply.send({ stats: await service.stats() });
  });

  app.get("/admin/users", async (request, reply) => {
    await app.requireAdmin(request);
    const { cursor } = request.query as { cursor?: string };
    reply.send({ users: await service.listUsers(cursor) });
  });

  app.get("/admin/products", async (request, reply) => {
    await app.requireAdmin(request);
    const { cursor } = request.query as { cursor?: string };
    reply.send({ products: await service.listProducts(cursor) });
  });

  app.get("/admin/payments", async (request, reply) => {
    await app.requireAdmin(request);
    const { cursor } = request.query as { cursor?: string };
    reply.send({ payments: await service.listPayments(cursor) });
  });

  app.get("/admin/reports", async (request, reply) => {
    await app.requireAdmin(request);
    const { status } = request.query as { status?: string };
    reply.send({ reports: await service.listReports(status) });
  });

  // Which authors this server federates — the operator's call, so the
  // list and the switch live here rather than in an author's dashboard.
  app.get("/admin/federation/creators", async (request, reply) => {
    await app.requireAdmin(request);
    reply.send({ creators: await federationSettings.listAll() });
  });

  app.patch("/admin/federation/creators/:username", async (request, reply) => {
    await app.requireAdmin(request);
    const { username } = request.params as { username: string };
    const parsed = updateSettingsSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    reply.send({ settings: await federationSettings.updateByUsername(username, parsed.data) });
  });

  app.get("/admin/federation/creators/:username/deliveries", async (request, reply) => {
    await app.requireAdmin(request);
    const { username } = request.params as { username: string };
    const { q, status, cursor } = request.query as { q?: string; status?: string; cursor?: string };
    reply.send(await service.listDeliveries(username, { q, status, cursor }));
  });

  app.get("/admin/federation/instances", async (request, reply) => {
    await app.requireAdmin(request);
    reply.send({ instances: await service.listInstances() });
  });

  app.get("/admin/audit-log", async (request, reply) => {
    await app.requireAdmin(request);
    const { cursor, q } = request.query as { cursor?: string; q?: string };
    reply.send({ entries: await service.listAuditLog(cursor, q) });
  });

  app.post("/admin/users/:id/suspend", async (request, reply) => {
    const admin = await app.requireAdmin(request);
    const { id } = request.params as { id: string };
    const parsed = suspendUserSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "A reason is required.");
    reply.send({ user: await service.suspendUser(admin.id, id, parsed.data) });
  });

  app.patch("/admin/users/:id/uploads", async (request, reply) => {
    const admin = await app.requireAdmin(request);
    const { id } = request.params as { id: string };
    const { allowed } = (request.body ?? {}) as { allowed?: unknown };
    if (typeof allowed !== "boolean") throw Errors.validation("`allowed` must be true or false.");
    reply.send({ user: await service.setUploads(admin.id, id, allowed) });
  });

  app.post("/admin/users/:id/restore", async (request, reply) => {
    const admin = await app.requireAdmin(request);
    const { id } = request.params as { id: string };
    reply.send({ user: await service.restoreUser(admin.id, id) });
  });

  app.post("/admin/products/:id/disable", async (request, reply) => {
    const admin = await app.requireAdmin(request);
    const { id } = request.params as { id: string };
    reply.send({ product: await service.setProductStatus(admin.id, id, true) });
  });

  app.post("/admin/products/:id/enable", async (request, reply) => {
    const admin = await app.requireAdmin(request);
    const { id } = request.params as { id: string };
    reply.send({ product: await service.setProductStatus(admin.id, id, false) });
  });

  app.post("/admin/reports/:id/resolve", async (request, reply) => {
    const admin = await app.requireAdmin(request);
    const { id } = request.params as { id: string };
    const parsed = resolveReportSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    reply.send({ report: await service.resolveReport(admin.id, id, parsed.data) });
  });

  app.post("/admin/federation/instances/:id/status", async (request, reply) => {
    const admin = await app.requireAdmin(request);
    const { id } = request.params as { id: string };
    const parsed = setInstanceStatusSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation("A valid status is required.");
    reply.send({ instance: await service.setInstanceStatus(admin.id, id, parsed.data) });
  });
}
