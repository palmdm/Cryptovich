import type { PrismaClient } from "@platform/db";
import { Errors } from "../../lib/errors.js";
import { EXT_TO_MIME } from "../../lib/image-mime.js";
import { requireCreatorProfile } from "../products/product-helpers.js";
import { storageService } from "../../lib/storage.js";
import { FolderService } from "../folders/service.js";

/** Where a stored file hangs. */
export type StoredFileSource = "attachment" | "folder" | "product-file" | "post-cover";

export interface StoredFile {
  /** `source:id` — unique across the list. */
  key: string;
  source: StoredFileSource;
  id: string;
  name: string;
  mimeType: string;
  /** Null for a cover, whose size is not recorded. */
  sizeBytes: number | null;
  createdAt: Date;
  /** The post it belongs to — a sold file, an attachment, a cover. */
  product: { id: string; title: string; deleted: boolean } | null;
  folder: { id: string; title: string } | null;
  /** API path that returns the bytes to the author. */
  downloadPath: string;
  /** Whether it can be deleted on its own. A file sold as a product is
   * deleted with its product: buyers' downloads depend on it. */
  deletable: boolean;
}

export type FileKind = "image" | "video" | "audio" | "other";

function kindOf(mimeType: string): FileKind {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "other";
}

/** How many of each kind are read — a ceiling, not a page size. */
const LIMIT = 1000;

/**
 * Every file an author has stored on this server, in one list: images
 * and files attached to posts, uploads in their folders, files sold as
 * products, and the covers of their locked posts. The author finds one by
 * name or by the post it is in, downloads it, or deletes it — through the
 * same service each kind already has, so ownership is checked and the
 * bytes leave storage along with the row.
 */
export class FileService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(userId: string, filter: { q?: string; kind?: FileKind } = {}): Promise<StoredFile[]> {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const creatorId = profile.id;

    const [attachments, uploads, soldFiles, covers] = await Promise.all([
      this.prisma.postAttachment.findMany({
        where: { post: { product: { creatorId } } },
        include: { post: { select: { product: { select: { id: true, title: true, deletedAt: true } } } } },
        orderBy: { createdAt: "desc" },
        take: LIMIT,
      }),
      this.prisma.folderItem.findMany({
        where: { kind: "UPLOAD", storageKey: { not: null }, folder: { creatorId, deletedAt: null } },
        include: { folder: { select: { id: true, title: true } } },
        orderBy: { createdAt: "desc" },
        take: LIMIT,
      }),
      this.prisma.digitalFile.findMany({
        where: { product: { creatorId } },
        include: { product: { select: { id: true, title: true, deletedAt: true } } },
        orderBy: { createdAt: "desc" },
        take: LIMIT,
      }),
      this.prisma.digitalProduct.findMany({
        where: { creatorId, coverUrl: { startsWith: "/covers/" } },
        select: { id: true, title: true, coverUrl: true, updatedAt: true, deletedAt: true },
        take: LIMIT,
      }),
    ]);

    const files: StoredFile[] = [
      ...attachments.map((a) => {
        const product = a.post.product;
        return {
          key: `attachment:${a.id}`,
          source: "attachment" as const,
          id: a.id,
          name: a.originalFilename,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          createdAt: a.createdAt,
          product: { id: product.id, title: product.title, deleted: product.deletedAt !== null },
          folder: null,
          downloadPath: `/products/${product.id}/attachments/${a.id}/file`,
          deletable: true,
        };
      }),
      ...uploads.map((u) => ({
        key: `folder:${u.id}`,
        source: "folder" as const,
        id: u.id,
        name: u.originalFilename ?? u.label ?? "file",
        mimeType: u.mimeType ?? "application/octet-stream",
        sizeBytes: u.sizeBytes === null ? null : Number(u.sizeBytes),
        createdAt: u.createdAt,
        product: null,
        folder: { id: u.folder.id, title: u.folder.title },
        downloadPath: `/folders/files/${u.id}`,
        deletable: true,
      })),
      ...soldFiles.map((f) => ({
        key: `product-file:${f.id}`,
        source: "product-file" as const,
        id: f.id,
        name: f.originalFilename,
        mimeType: f.mimeType,
        sizeBytes: Number(f.sizeBytes),
        createdAt: f.createdAt,
        product: { id: f.product.id, title: f.product.title, deleted: f.product.deletedAt !== null },
        folder: null,
        downloadPath: `/products/${f.product.id}/file`,
        deletable: false,
      })),
      ...covers.map((c) => {
        const key = c.coverUrl!.split("/").pop()!;
        return {
          key: `post-cover:${c.id}`,
          source: "post-cover" as const,
          id: c.id,
          name: key,
          mimeType: EXT_TO_MIME[key.split(".").pop() ?? ""] ?? "image/webp",
          sizeBytes: null,
          createdAt: c.updatedAt,
          product: { id: c.id, title: c.title, deleted: c.deletedAt !== null },
          folder: null,
          downloadPath: c.coverUrl!,
          deletable: true,
        };
      }),
    ];

    const q = filter.q?.trim().toLowerCase();
    return files
      .filter((file) => !filter.kind || kindOf(file.mimeType) === filter.kind)
      .filter(
        (file) =>
          !q ||
          file.name.toLowerCase().includes(q) ||
          (file.product?.title.toLowerCase().includes(q) ?? false) ||
          (file.folder?.title.toLowerCase().includes(q) ?? false),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Deletes one file through the service that owns its kind — which checks
   * it is the author's and removes the bytes from storage with the row.
   */
  async remove(userId: string, source: string, id: string): Promise<void> {
    const profile = await requireCreatorProfile(this.prisma, userId);
    switch (source) {
      case "attachment": {
        const attachment = await this.prisma.postAttachment.findUnique({
          where: { id },
          include: { post: { select: { product: { select: { creatorId: true } } } } },
        });
        if (!attachment || attachment.post.product.creatorId !== profile.id) throw Errors.notFound("File");
        // Directly rather than through the post: a deleted post's files are
        // still the author's to clear, and the post routes no longer find it.
        await this.prisma.postAttachment.delete({ where: { id } });
        await storageService.delete(attachment.storageKey).catch(() => {});
        return;
      }
      case "folder": {
        const item = await this.prisma.folderItem.findUnique({ where: { id }, include: { folder: true } });
        if (!item || item.kind !== "UPLOAD" || item.folder.creatorId !== profile.id) throw Errors.notFound("File");
        await new FolderService(this.prisma).removeItem(userId, item.folderId, id);
        return;
      }
      case "post-cover": {
        const product = await this.prisma.digitalProduct.findUnique({ where: { id }, select: { creatorId: true, coverUrl: true } });
        if (!product || product.creatorId !== profile.id || !product.coverUrl) throw Errors.notFound("File");
        await this.prisma.digitalProduct.update({ where: { id }, data: { coverUrl: null } });
        const key = product.coverUrl.match(/^\/covers\/([0-9a-f-]{36}\.(?:png|jpeg|gif|webp))$/)?.[1];
        if (key) await storageService.delete(key).catch(() => {});
        return;
      }
      case "product-file":
        throw Errors.validation("A file sold as a product is deleted by deleting that product — buyers' downloads depend on it.");
      default:
        throw Errors.notFound("File");
    }
  }
}
