import type { PrismaClient } from "@platform/db";
import { Errors } from "../../lib/errors.js";
import { requireCreatorProfile, uniqueSlug } from "../products/product-helpers.js";
import { storageService } from "../../lib/storage.js";
import { MIME_TO_EXT } from "../../lib/image-mime.js";
import type { CreateFolderInput, UpdateFolderInput, AddItemInput } from "./schemas.js";
import { megabytes, SettingsService } from "../settings/service.js";

/**
 * An author's own grouping of their work — a mix of posts (free or paid),
 * files they upload straight in, and links out.
 *
 * A folder is a *container*, never an access rule. A paid post inside one
 * is still gated by EntitlementService and still appears in the listing
 * with its title and price, exactly as it does outside; joining a folder
 * neither unlocks it nor hides it. Anything that needs paying for is a
 * product, so there is only ever one gating path to reason about — which
 * is why an uploaded folder file is deliberately public and a paid file
 * is a DIGITAL_FILE product placed in the folder instead.
 */
export class FolderService {
  constructor(private readonly prisma: PrismaClient) {}

  private async requireOwnFolder(userId: string, folderId: string) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const folder = await this.prisma.folder.findUnique({ where: { id: folderId } });
    if (!folder || folder.creatorId !== profile.id || folder.deletedAt) throw Errors.notFound("Folder");
    return { profile, folder };
  }

  async create(userId: string, input: CreateFolderInput) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const slug = await this.uniqueFolderSlug(profile.id, input.title);
    const last = await this.prisma.folder.findFirst({
      where: { creatorId: profile.id, deletedAt: null },
      orderBy: { position: "desc" },
      select: { position: true },
    });

    return this.prisma.folder.create({
      data: {
        creatorId: profile.id,
        title: input.title,
        description: input.description,
        slug,
        position: (last?.position ?? -1) + 1,
      },
    });
  }

  /** Mirrors `uniqueSlug` for products, but scoped to this creator's folders. */
  private async uniqueFolderSlug(creatorId: string, title: string): Promise<string> {
    const base = await uniqueSlug(this.prisma, creatorId, title);
    let attempt = 0;
    for (;;) {
      const candidate = attempt === 0 ? base : `${base}-${attempt}`;
      const clash = await this.prisma.folder.findUnique({
        where: { creatorId_slug: { creatorId, slug: candidate } },
      });
      if (!clash) return candidate;
      attempt += 1;
    }
  }

  async update(userId: string, folderId: string, input: UpdateFolderInput) {
    await this.requireOwnFolder(userId, folderId);
    return this.prisma.folder.update({
      where: { id: folderId },
      data: { title: input.title, description: input.description, position: input.position },
    });
  }

  /**
   * Soft delete, like a post: the folder disappears from the page but the
   * products that were in it are untouched — removing a grouping must
   * never remove the work.
   */
  async remove(userId: string, folderId: string) {
    await this.requireOwnFolder(userId, folderId);
    return this.prisma.folder.update({ where: { id: folderId }, data: { deletedAt: new Date() } });
  }

  async listMine(userId: string) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const folders = await this.prisma.folder.findMany({
      where: { creatorId: profile.id, deletedAt: null },
      include: { _count: { select: { items: true } } },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    return folders.map((f) => ({ ...f, itemCount: f._count.items }));
  }

  async addItem(userId: string, folderId: string, input: AddItemInput) {
    const { profile } = await this.requireOwnFolder(userId, folderId);

    if (input.kind === "PRODUCT") {
      // Only the author's own work, or a folder becomes a way to list
      // someone else's post under your name.
      const product = await this.prisma.digitalProduct.findUnique({ where: { id: input.productId } });
      if (!product || product.creatorId !== profile.id || product.deletedAt) throw Errors.notFound("Product");

      const existing = await this.prisma.folderItem.findUnique({
        where: { folderId_productId: { folderId, productId: input.productId } },
      });
      if (existing) throw Errors.validation("That post is already in this folder.");
    }

    const last = await this.prisma.folderItem.findFirst({
      where: { folderId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const position = (last?.position ?? -1) + 1;

    return this.prisma.folderItem.create({
      data:
        input.kind === "PRODUCT"
          ? { folderId, kind: "PRODUCT", productId: input.productId, position }
          : { folderId, kind: "LINK", url: input.url, label: input.label, position },
    });
  }

  /** A small file dropped straight into the folder. Public by design — see the class note. */
  async addUpload(
    userId: string,
    folderId: string,
    file: { buffer: Buffer; mimeType: string; filename: string },
  ) {
    await this.requireOwnFolder(userId, folderId);

    const limit = await new SettingsService(this.prisma).maxUploadBytes(userId);

    if (file.buffer.byteLength > limit) {
      throw Errors.validation(
        `Files must be ${megabytes(limit)} or smaller. Link to it instead if it's bigger.`,
      );
    }

    // Extension only from the server's own map, never from the client's
    // filename — the stored key must not be attacker-chosen.
    const extension = MIME_TO_EXT[file.mimeType];
    const storageKey = await storageService.save(file.buffer, extension);

    const last = await this.prisma.folderItem.findFirst({
      where: { folderId },
      orderBy: { position: "desc" },
      select: { position: true },
    });

    return this.prisma.folderItem.create({
      data: {
        folderId,
        kind: "UPLOAD",
        storageKey,
        originalFilename: file.filename,
        mimeType: file.mimeType,
        sizeBytes: BigInt(file.buffer.byteLength),
        label: file.filename,
        position: (last?.position ?? -1) + 1,
      },
    });
  }

  async removeItem(userId: string, folderId: string, itemId: string) {
    await this.requireOwnFolder(userId, folderId);
    const item = await this.prisma.folderItem.findUnique({ where: { id: itemId } });
    if (!item || item.folderId !== folderId) throw Errors.notFound("Item");

    // The uploaded bytes go with the row; a product's do not, because the
    // product still exists outside the folder.
    if (item.kind === "UPLOAD" && item.storageKey) {
      await storageService.delete(item.storageKey);
    }
    await this.prisma.folderItem.delete({ where: { id: itemId } });
  }

  async reorderItems(userId: string, folderId: string, itemIds: string[]) {
    await this.requireOwnFolder(userId, folderId);
    const items = await this.prisma.folderItem.findMany({ where: { folderId }, select: { id: true } });
    const known = new Set(items.map((i) => i.id));
    if (itemIds.length !== known.size || itemIds.some((id) => !known.has(id))) {
      throw Errors.validation("That ordering doesn't match this folder's contents.");
    }
    await this.prisma.$transaction(
      itemIds.map((id, position) => this.prisma.folderItem.update({ where: { id }, data: { position } })),
    );
  }

  /** The public list on an author's page. */
  async listForCreator(username: string) {
    const profile = await this.prisma.creatorProfile.findFirst({
      where: { user: { username, deletedAt: null } },
      select: { id: true },
    });
    if (!profile) return [];

    const folders = await this.prisma.folder.findMany({
      where: { creatorId: profile.id, deletedAt: null },
      include: { _count: { select: { items: true } } },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    return folders.map((f) => ({
      id: f.id,
      title: f.title,
      slug: f.slug,
      description: f.description,
      itemCount: f._count.items,
    }));
  }

  /**
   * One folder's contents, for anyone. Published products only — a draft
   * must not become visible just because it sits in a folder — and never
   * any post body: opening a post still goes through the store endpoint,
   * which asks EntitlementService.
   */
  async getPublic(username: string, slug: string) {
    const profile = await this.prisma.creatorProfile.findFirst({
      where: { user: { username, deletedAt: null } },
      select: { id: true },
    });
    if (!profile) throw Errors.notFound("Folder");

    const folder = await this.prisma.folder.findUnique({
      where: { creatorId_slug: { creatorId: profile.id, slug } },
      include: {
        items: {
          orderBy: [{ position: "asc" }, { createdAt: "asc" }],
          include: {
            product: {
              include: { prices: { where: { active: true } } },
            },
          },
        },
      },
    });
    if (!folder || folder.deletedAt) throw Errors.notFound("Folder");

    return {
      id: folder.id,
      title: folder.title,
      slug: folder.slug,
      description: folder.description,
      items: folder.items
        .filter((item) => item.kind !== "PRODUCT" || (item.product && item.product.status === "PUBLISHED" && !item.product.deletedAt))
        .map((item) => ({
          id: item.id,
          kind: item.kind,
          label: item.label,
          url: item.kind === "LINK" ? item.url : null,
          // The download goes back through the API so the file is served
          // with a checked content type rather than from a bucket URL.
          downloadUrl: item.kind === "UPLOAD" ? `/folders/files/${item.id}` : null,
          originalFilename: item.originalFilename,
          sizeBytes: item.sizeBytes?.toString() ?? null,
          product: item.product
            ? {
                id: item.product.id,
                type: item.product.type,
                title: item.product.title,
                slug: item.product.slug,
                description: item.product.description,
                visibility: item.product.visibility,
                prices: item.product.prices,
                publishedAt: item.product.publishedAt,
              }
            : null,
        })),
    };
  }

  /** Resolves an uploaded folder file for download. Public, like the folder itself. */
  async getUploadForDownload(itemId: string) {
    const item = await this.prisma.folderItem.findUnique({
      where: { id: itemId },
      include: { folder: { select: { deletedAt: true } } },
    });
    if (!item || item.kind !== "UPLOAD" || !item.storageKey || item.folder.deletedAt) {
      throw Errors.notFound("File");
    }
    return item;
  }
}
