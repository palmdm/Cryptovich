import type { FastifyInstance } from "fastify";
import { SharkeyStickerProvider } from "@platform/integrations";
import { z } from "zod";
import { Errors } from "../../lib/errors.js";
import { readMultipartFile } from "../../lib/multipart.js";
import { storageService } from "../../lib/storage.js";
import { ServerEmojiService, instanceOrigin } from "./service.js";
import { importSchema, importPreviewSchema, renameSetSchema } from "./schemas.js";

const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(gif|png|webp|jpeg)$/;
const EXT_MIME: Record<string, string> = { gif: "image/gif", png: "image/png", webp: "image/webp", jpeg: "image/jpeg" };

/** An administrator adding a folder of stickers sends one request per file. */
const adminUploadLimit = { max: 240, timeWindow: "1 minute" as const };

export default async function serverEmojiRoutes(app: FastifyInstance) {
  const service = new ServerEmojiService(app.prisma);

  // Public: every page renders :shortcodes: and the reaction picker lists them.
  app.get("/emoji/server", async (_request, reply) => {
    reply.header("Cache-Control", "public, max-age=60").send({ emoji: await service.list() });
  });

  // A key is a UUID chosen when the file was stored: the bytes behind a URL
  // never change, so it is cached for good.
  app.get("/emoji/files/:key", { logLevel: "warn" }, async (request, reply) => {
    const { key } = request.params as { key: string };
    if (!KEY_PATTERN.test(key) || !(await storageService.exists(key))) throw Errors.notFound("Sticker");
    return reply
      .header("Content-Type", EXT_MIME[key.split(".").pop()!]!)
      .header("X-Content-Type-Options", "nosniff")
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .send(storageService.readStream(key));
  });

  app.post("/admin/emoji", { config: { rateLimit: adminUploadLimit } }, async (request, reply) => {
    const admin = await app.requireAdmin(request);
    const { shortcode, category } = request.query as { shortcode?: string; category?: string };
    const file = await readMultipartFile(request);
    reply.code(201).send({ emoji: await service.upload(admin.id, file, { shortcode, category }) });
  });

  app.patch("/admin/emoji/:id", async (request, reply) => {
    const admin = await app.requireAdmin(request);
    const { id } = request.params as { id: string };
    const parsed = z.object({ shortcode: z.string().max(40).optional(), category: z.string().max(80).optional() }).safeParse(request.body);
    if (!parsed.success) throw Errors.validation("Invalid sticker.");
    reply.send({ emoji: await service.update(admin.id, id, parsed.data) });
  });

  app.delete("/admin/emoji/:id", async (request, reply) => {
    const admin = await app.requireAdmin(request);
    const { id } = request.params as { id: string };
    await service.remove(admin.id, id);
    reply.send({ ok: true });
  });

  app.delete("/admin/emoji-sets/:category", async (request, reply) => {
    const admin = await app.requireAdmin(request);
    const { category } = request.params as { category: string };
    reply.send({ removed: await service.removeCategory(admin.id, decodeURIComponent(category)) });
  });

  app.post("/admin/emoji/imports", async (request, reply) => {
    const admin = await app.requireAdmin(request);
    const parsed = importSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid import.");
    reply.code(202).send({ job: await service.enqueueImport(admin.id, parsed.data) });
  });

  // Which sets a fediverse instance has, before importing any: Misskey's
  // and Sharkey's categories, or Mastodon's.
  app.post("/admin/emoji/imports/preview", async (request, reply) => {
    await app.requireAdmin(request);
    const parsed = importPreviewSchema.safeParse(request.body);
    const origin = parsed.success ? instanceOrigin(parsed.data.sourceRef) : null;
    if (!origin) throw Errors.validation("Give the instance's address, e.g. https://example.social.");
    try {
      reply.send({ instance: origin, ...(await new SharkeyStickerProvider(origin).categories()) });
    } catch (err) {
      throw Errors.validation(err instanceof Error ? err.message : "The instance's emoji list could not be read.");
    }
  });

  app.get("/admin/emoji/imports", async (request, reply) => {
    await app.requireAdmin(request);
    reply.send({ jobs: await service.listImports() });
  });

  app.delete("/admin/emoji/imports", async (request, reply) => {
    const admin = await app.requireAdmin(request);
    reply.send({ removed: await service.clearImports(admin.id) });
  });

  app.get("/admin/emoji/imports/:id/log", async (request, reply) => {
    await app.requireAdmin(request);
    const { id } = request.params as { id: string };
    const { q, outcome, cursor } = request.query as { q?: string; outcome?: string; cursor?: string };
    reply.send(await service.importLog(id, { q, outcome, cursor }));
  });

  app.patch("/admin/emoji-sets/:category", async (request, reply) => {
    const admin = await app.requireAdmin(request);
    const { category } = request.params as { category: string };
    const parsed = renameSetSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    reply.send({ renamed: await service.renameCategory(admin.id, decodeURIComponent(category), parsed.data.name) });
  });
}
