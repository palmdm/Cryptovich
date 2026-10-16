import type { FastifyInstance } from "fastify";
import { createFolderSchema, updateFolderSchema, addItemSchema, reorderItemsSchema } from "./schemas.js";
import { FolderService } from "./service.js";
import { storageService } from "../../lib/storage.js";
import { readMultipartFile } from "../../lib/multipart.js";
import { requireUploadPrivilege } from "../../lib/upload-privilege.js";
import { SAFE_INLINE_MIME_TYPES } from "../../lib/safe-inline-mime.js";
import { Errors } from "../../lib/errors.js";
import { uploadRateLimit } from "../../lib/upload-rate-limit.js";

export default async function folderRoutes(app: FastifyInstance) {
  const service = new FolderService(app.prisma);

  // --- author ------------------------------------------------------------

  app.get("/folders/mine", async (request, reply) => {
    const user = await app.requireAuth(request);
    reply.send({ folders: await service.listMine(user.id) });
  });

  app.post("/folders", async (request, reply) => {
    const user = await app.requireAuth(request);
    const parsed = createFolderSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    reply.code(201).send({ folder: await service.create(user.id, parsed.data) });
  });

  app.patch("/folders/:id", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    const parsed = updateFolderSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    reply.send({ folder: await service.update(user.id, id, parsed.data) });
  });

  app.delete("/folders/:id", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    await service.remove(user.id, id);
    reply.send({ ok: true });
  });

  app.post("/folders/:id/items", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    const parsed = addItemSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    reply.code(201).send({ item: await service.addItem(user.id, id, parsed.data) });
  });

  app.post("/folders/:id/uploads", { config: { rateLimit: uploadRateLimit } }, async (request, reply) => {
    const user = await app.requireAuth(request);
    // Storage costs the operator money, so the same grant gates this as
    // every other server-side upload — checked before the body is read.
    await requireUploadPrivilege(app.prisma, user.id);
    const { id } = request.params as { id: string };
    const file = await readMultipartFile(request);
    reply.code(201).send({ item: await service.addUpload(user.id, id, file) });
  });

  app.delete("/folders/:id/items/:itemId", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id, itemId } = request.params as { id: string; itemId: string };
    await service.removeItem(user.id, id, itemId);
    reply.send({ ok: true });
  });

  app.put("/folders/:id/items/order", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    const parsed = reorderItemsSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    await service.reorderItems(user.id, id, parsed.data.itemIds);
    reply.send({ ok: true });
  });

  // --- public ------------------------------------------------------------

  // Under /creators rather than /folders/:username: "mine" and "files"
  // are valid usernames, so a parametric /folders/:username would be
  // shadowed by the static author routes above for exactly those people.
  app.get("/creators/:username/folders", async (request, reply) => {
    const { username } = request.params as { username: string };
    reply.send({ folders: await service.listForCreator(username) });
  });

  app.get("/creators/:username/folders/:slug", async (request, reply) => {
    const { username, slug } = request.params as { username: string; slug: string };
    reply.send({ folder: await service.getPublic(username, slug) });
  });

  // A folder upload is public, like the folder listing it appears in.
  // Anything that needs paying for is a DIGITAL_FILE product and goes
  // through the entitlement-checked download route instead.
  app.get("/folders/files/:itemId", { logLevel: "warn" }, async (request, reply) => {
    const { itemId } = request.params as { itemId: string };
    const item = await service.getUploadForDownload(itemId);
    const safeFilename = (item.originalFilename ?? "file").replace(/["\\]/g, "_");
    const mimeType = item.mimeType ?? "application/octet-stream";
    // Allowlist, not denylist: only a type known safe to render gets
    // `inline`, so an uploaded .html can never execute in this origin.
    const disposition = SAFE_INLINE_MIME_TYPES.has(mimeType) ? "inline" : `attachment; filename="${safeFilename}"`;
    return reply
      .header("Content-Type", mimeType)
      .header("Content-Disposition", disposition)
      .header("X-Content-Type-Options", "nosniff")
      .send(storageService.readStream(item.storageKey!));
  });
}
