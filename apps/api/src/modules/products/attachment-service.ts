import type { PrismaClient } from "@platform/db";
import { processImage } from "../../lib/image-resize.js";
import { Errors } from "../../lib/errors.js";
import { EntitlementService } from "../entitlements/service.js";
import { storageService, type StorageBackend } from "../../lib/storage.js";
import { requireCreatorProfile, requireOwnedProduct } from "./product-helpers.js";
import { megabytes, SettingsService } from "../settings/service.js";

type AttachmentKind = "IMAGE" | "VIDEO" | "AUDIO" | "FILE";

function inferKind(mimeType: string): AttachmentKind {
  if (mimeType.startsWith("image/")) return "IMAGE";
  if (mimeType.startsWith("video/")) return "VIDEO";
  if (mimeType.startsWith("audio/")) return "AUDIO";
  return "FILE";
}

export class AttachmentService {
  private readonly entitlements: EntitlementService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: StorageBackend = storageService,
  ) {
    this.entitlements = new EntitlementService(prisma);
  }

  async upload(userId: string, productId: string, file: { buffer: Buffer; mimeType: string; filename: string }) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const product = await requireOwnedProduct(this.prisma, profile.id, productId);
    if (product.type !== "POST") throw Errors.validation("Attachments can only be added to posts.");

    // Defense in depth: `readMultipartFile` already rejects an oversized
    // upload via the registered fileSize limit before a buffer ever
    // reaches here, but a service method shouldn't trust that its only
    // caller is that one route.
    const limit = await new SettingsService(this.prisma).maxUploadBytes(userId);
    if (file.buffer.byteLength > limit) {
      throw Errors.validation(`Files must be ${megabytes(limit)} or smaller.`);
    }

    const post = await this.prisma.post.findUnique({ where: { productId } });
    if (!post) throw Errors.notFound("Post");

    // An image is stored at the size a post displays it at; everything
    // else (video, audio, documents) is stored exactly as uploaded.
    const processed = await processImage(file.buffer, file.mimeType, "attachment");
    const storageKey = await this.storage.save(processed.buffer);
    const position = await this.prisma.postAttachment.count({ where: { postId: post.id } });

    return this.prisma.postAttachment.create({
      data: {
        postId: post.id,
        kind: inferKind(processed.mimeType),
        storageKey,
        mimeType: processed.mimeType,
        sizeBytes: processed.buffer.byteLength,
        originalFilename: file.filename,
        position,
      },
    });
  }

  async remove(userId: string, productId: string, attachmentId: string) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const product = await requireOwnedProduct(this.prisma, profile.id, productId);
    const post = await this.prisma.post.findUnique({ where: { productId: product.id } });
    const attachment = await this.prisma.postAttachment.findUnique({ where: { id: attachmentId } });
    if (!post || !attachment || attachment.postId !== post.id) throw Errors.notFound("Attachment");

    await this.prisma.postAttachment.delete({ where: { id: attachmentId } });
    await this.storage.delete(attachment.storageKey);
  }

  /**
   * Re-runs the exact same access decision the post's own text content goes
   * through before handing back anything that lets a caller read the file
   * bytes — an attachment is never reachable by a URL that skips
   * EntitlementService (spec rule #13/#61).
   */
  async getForDownload(userId: string | null, productId: string, attachmentId: string) {
    const decision = await this.entitlements.canAccessProduct(userId, productId);
    if (!decision.allowed) throw Errors.forbidden();

    const post = await this.prisma.post.findUnique({ where: { productId } });
    const attachment = await this.prisma.postAttachment.findUnique({ where: { id: attachmentId } });
    if (!post || !attachment || attachment.postId !== post.id) throw Errors.notFound("Attachment");

    return attachment;
  }
}
