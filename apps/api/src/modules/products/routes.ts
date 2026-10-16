import { SettingsService } from "../settings/service.js";
import type { FastifyInstance } from "fastify";
import { createPostSchema, updatePostSchema } from "./schemas.js";
import { ProductService } from "./service.js";
import { PinService } from "./pin-service.js";
import { ActivityPubService } from "../activitypub/service.js";
import { AttachmentService } from "./attachment-service.js";
import { storageService } from "../../lib/storage.js";
import { readMultipartFile } from "../../lib/multipart.js";
import { SAFE_INLINE_MIME_TYPES } from "../../lib/safe-inline-mime.js";
import { requireUploadPrivilege } from "../../lib/upload-privilege.js";
import { Errors } from "../../lib/errors.js";
import { uploadRateLimit } from "../../lib/upload-rate-limit.js";

export default async function productRoutes(app: FastifyInstance) {
  // What the editor counts toward (a public number, the same for everyone).
  app.get("/posts/limits", async (_request, reply) => {
    reply.header("Cache-Control", "public, max-age=60").send({ maxChars: await new SettingsService(app.prisma).postMaxChars() });
  });

  const service = new ProductService(app.prisma);
  const attachments = new AttachmentService(app.prisma);
  // A pin change is a profile change as far as the fediverse is concerned:
  // Mastodon re-reads an actor's pinned posts when told the actor changed.
  const federation = new ActivityPubService(app.prisma, undefined, app.log);
  const pins = new PinService(app.prisma, (creatorId) => federation.enqueueProfileUpdate(creatorId));

  app.get("/products/pins", async (request, reply) => {
    const user = await app.requireAuth(request);
    reply.send(await pins.state(user.id));
  });

  app.post("/products/:id/pin", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    reply.send(await pins.pin(user.id, id));
  });

  app.delete("/products/:id/pin", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    reply.send(await pins.unpin(user.id, id));
  });

  app.post("/products/posts", async (request, reply) => {
    const user = await app.requireAuth(request);
    const parsed = createPostSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    const product = await service.createPost(user.id, parsed.data);
    reply.code(201).send({ product });
  });

  app.post("/products/:id/publish", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    const product = await service.publish(user.id, id);
    reply.send({ product });
  });

  app.post("/products/:id/unpublish", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    const product = await service.unpublish(user.id, id);
    reply.send({ product });
  });

  app.get("/products/mine", async (request, reply) => {
    const user = await app.requireAuth(request);
    const products = await service.listMine(user.id);
    reply.send({ products });
  });

  app.get("/products/mine/:id", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    const product = await service.getMine(user.id, id);
    reply.send({ product });
  });

  app.patch("/products/:id", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    const parsed = updatePostSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    const product = await service.updatePost(user.id, id, parsed.data);
    reply.send({ product });
  });

  app.delete("/products/:id", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    await service.remove(user.id, id);
    reply.send({ ok: true });
  });

  app.post("/products/:id/cover", { config: { rateLimit: uploadRateLimit } }, async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    const file = await readMultipartFile(request);
    reply.send({ product: await service.uploadCover(user.id, id, file) });
  });

  app.delete("/products/:id/cover", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    reply.send({ product: await service.removeCover(user.id, id) });
  });

  app.post("/products/:id/attachments", { config: { rateLimit: uploadRateLimit } }, async (request, reply) => {
    const user = await app.requireAuth(request);
    // Checked before the body is read, so a refused upload does not cost
    // the bandwidth it was refused for.
    await requireUploadPrivilege(app.prisma, user.id);
    const { id } = request.params as { id: string };
    const file = await readMultipartFile(request);
    const attachment = await attachments.upload(user.id, id, file);
    reply.code(201).send({ attachment });
  });

  app.delete("/products/:id/attachments/:attachmentId", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id, attachmentId } = request.params as { id: string; attachmentId: string };
    await attachments.remove(user.id, id, attachmentId);
    reply.send({ ok: true });
  });

  // Public path, but access is decided entirely by EntitlementService —
  // the URL carries no secret of its own (spec rule #13/#61).
  app.get("/products/:id/attachments/:attachmentId/file", { logLevel: "warn" }, async (request, reply) => {
    const { id, attachmentId } = request.params as { id: string; attachmentId: string };
    const attachment = await attachments.getForDownload(request.currentUser?.id ?? null, id, attachmentId);
    // Allowlist, not denylist: only a MIME type we know is safe to render
    // gets `inline` — everything else (including a client-claimed
    // "image/svg+xml" or "text/html" trying to pass as IMAGE/FILE) is
    // forced to download, so nothing ever executes in the browser just
    // from opening an attachment URL.
    const safeFilename = attachment.originalFilename.replace(/["\\]/g, "_");
    const disposition = SAFE_INLINE_MIME_TYPES.has(attachment.mimeType) ? "inline" : `attachment; filename="${safeFilename}"`;
    // The `return` matters: with an async handler, Fastify only keeps the
    // response open until the handler's own promise resolves — without it,
    // the piped stream gets cut off before any bytes actually reach the
    // client (empty body, 200 status, no error).
    return reply
      .header("Content-Type", attachment.mimeType)
      .header("Content-Length", attachment.sizeBytes)
      .header("Content-Disposition", disposition)
      .header("X-Content-Type-Options", "nosniff")
      // Cached in the reader's own browser only — never in a shared proxy.
      // Access is re-checked on every request, and `public` would let one
      // reader's copy be served to someone who may not read it at all.
      .header("Cache-Control", "private, max-age=3600")
      .send(storageService.readStream(attachment.storageKey));
  });
}
