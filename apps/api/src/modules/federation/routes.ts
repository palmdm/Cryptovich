import type { FastifyInstance } from "fastify";
import { updateSettingsSchema, addInstanceSchema, publishSchema } from "./schemas.js";
import { FederationSettingsService, FederationInstanceService, FederatedPostService } from "./service.js";
import { Errors } from "../../lib/errors.js";

/**
 * Federation, as the operator's own controls.
 *
 * These were author-facing: an author switched their own federation on,
 * chose which instances to reach, and pushed their posts out. But what
 * leaves this server and where it goes is a server-wide policy — it
 * carries the instance's reputation, its outbound traffic and its
 * moderation load, and somebody following from elsewhere is following
 * *this server*. So every route here belongs to an administrator and is
 * addressed at the author it acts on; the author-facing page is gone.
 *
 * The server-wide switch itself is a setting (`federationEnabled`), which
 * sits with the operator's other switches in the admin module.
 */
export default async function federationRoutes(app: FastifyInstance) {
  const settingsService = new FederationSettingsService(app.prisma);
  const instanceService = new FederationInstanceService(app.prisma);
  const postService = new FederatedPostService(app.prisma);

  /** The author a route acts on, as a user id. */
  async function targetUserId(username: string): Promise<string> {
    const user = await app.prisma.user.findFirst({ where: { username, deletedAt: null }, select: { id: true } });
    if (!user) throw Errors.notFound("Author");
    return user.id;
  }

  app.get("/admin/federation/creators/:username/settings", async (request, reply) => {
    await app.requireAdmin(request);
    const { username } = request.params as { username: string };
    reply.send({ settings: await settingsService.get(await targetUserId(username)) });
  });

  app.patch("/admin/federation/creators/:username/settings", async (request, reply) => {
    await app.requireAdmin(request);
    const { username } = request.params as { username: string };
    const parsed = updateSettingsSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    reply.send({ settings: await settingsService.update(await targetUserId(username), parsed.data) });
  });

  // Which instances this author's posts reach. The domain itself is still
  // approved separately (/admin/federation/instances): adding it here says
  // "send this author's posts there", not "trust this domain".
  app.get("/admin/federation/creators/:username/instances", async (request, reply) => {
    await app.requireAdmin(request);
    const { username } = request.params as { username: string };
    reply.send({ instances: await instanceService.listMine(await targetUserId(username)) });
  });

  app.post("/admin/federation/creators/:username/instances", async (request, reply) => {
    await app.requireAdmin(request);
    const { username } = request.params as { username: string };
    const parsed = addInstanceSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    const instance = await instanceService.addToAllowlist(await targetUserId(username), parsed.data);
    reply.code(201).send({ instance });
  });

  app.delete("/admin/federation/creators/:username/instances/:id", async (request, reply) => {
    await app.requireAdmin(request);
    const { username, id } = request.params as { username: string; id: string };
    await instanceService.removeFromAllowlist(await targetUserId(username), id);
    reply.send({ ok: true });
  });

  // Pushing one post out, and pulling it back. Auto-publish covers the
  // ordinary case; these are for an operator dealing with a single post.
  app.post("/admin/federation/creators/:username/posts/:productId/publish", async (request, reply) => {
    await app.requireAdmin(request);
    const { username, productId } = request.params as { username: string; productId: string };
    const parsed = publishSchema.safeParse(request.body ?? {});
    if (!parsed.success) throw Errors.validation("Invalid input.");
    const jobs = await postService.publish(await targetUserId(username), productId, parsed.data.instanceIds);
    reply.code(201).send({ jobs });
  });

  app.post("/admin/federation/creators/:username/posts/:productId/retract", async (request, reply) => {
    await app.requireAdmin(request);
    const { username, productId } = request.params as { username: string; productId: string };
    reply.send({ results: await postService.retract(await targetUserId(username), productId) });
  });

  app.get("/admin/federation/creators/:username/posts/:productId", async (request, reply) => {
    await app.requireAdmin(request);
    const { username, productId } = request.params as { username: string; productId: string };
    reply.send({ federatedPosts: await postService.listForPost(await targetUserId(username), productId) });
  });
}
