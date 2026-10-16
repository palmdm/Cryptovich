import type { FastifyRequest } from "fastify";
import { Errors } from "./errors.js";
import { megabytes, SettingsService } from "../modules/settings/service.js";

/**
 * Reads the single uploaded file off a multipart request as a buffer,
 * turning `@fastify/multipart`'s internal "too large" error (thrown by
 * `toBuffer()` once the stream hits the registered `fileSize` limit) into
 * the same user-safe validation error every other size/shape check in this
 * codebase produces — never a raw framework error reaching the client.
 */
export async function readMultipartFile(request: FastifyRequest): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
  // The `maxUploadBytes` setting, read per upload so a change in the admin
  // area applies to the next file; one byte over makes "too large" visible.
  const limit = await new SettingsService(request.server.prisma).maxUploadBytes(request.currentUser?.id);
  const data = await request.file({ limits: { fileSize: limit + 1 } });
  if (!data) throw Errors.validation("A file is required.");

  try {
    const buffer = await data.toBuffer();
    return { buffer, mimeType: data.mimetype, filename: data.filename };
  } catch (err) {
    if (err instanceof Error && (err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") {
      throw Errors.validation(`Files must be ${megabytes(limit)} or smaller.`);
    }
    throw err;
  }
}
