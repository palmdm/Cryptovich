import type { FastifyInstance } from "fastify";
import { createFileProductSchema } from "./schemas.js";
import { DigitalFileService } from "./service.js";
import { storageService } from "../../lib/storage.js";
import { readMultipartFile } from "../../lib/multipart.js";
import { requireUploadPrivilege } from "../../lib/upload-privilege.js";
import { Errors } from "../../lib/errors.js";
import { uploadRateLimit } from "../../lib/upload-rate-limit.js";

export default async function digitalFileRoutes(app: FastifyInstance) {
  const service = new DigitalFileService(app.prisma);

  app.post("/products/files", { config: { rateLimit: uploadRateLimit } }, async (request, reply) => {
    const user = await app.requireAuth(request);
    const parsed = createFileProductSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    reply.code(201).send({ product: await service.createProduct(user.id, parsed.data) });
  });

  app.post("/products/:id/file", async (request, reply) => {
    const user = await app.requireAuth(request);
    await requireUploadPrivilege(app.prisma, user.id);
    const { id } = request.params as { id: string };
    const file = await readMultipartFile(request);
    reply.code(201).send({ file: await service.attachFile(user.id, id, file) });
  });

  // Public path, but access is decided entirely by EntitlementService —
  // the URL carries no secret of its own. A sold file is always sent as an
  // attachment: nothing a buyer uploads should ever render in the browser.
  app.get("/products/:id/file", { logLevel: "warn" }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const file = await service.getForDownload(request.currentUser?.id ?? null, id);
    const safeFilename = file.originalFilename.replace(/["\\]/g, "_");
    return reply
      .header("Content-Type", file.mimeType)
      .header("Content-Length", file.sizeBytes.toString())
      .header("Content-Disposition", `attachment; filename="${safeFilename}"`)
      .header("X-Content-Type-Options", "nosniff")
      .send(storageService.readStream(file.storageKey));
  });
}
