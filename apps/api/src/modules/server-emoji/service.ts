import { importSchema } from "./schemas.js";
import type { Prisma, PrismaClient } from "@platform/db";
import sharp from "sharp";
import { isSafeHttpUrl, toShortcode } from "@platform/shared";
import { z } from "zod";
import { Errors } from "../../lib/errors.js";
import { logAdminAction } from "../../lib/audit-log.js";
import { storageService } from "../../lib/storage.js";
import { sniffImage } from "../../lib/image-mime.js";
import { SettingsService } from "../settings/service.js";
export { sniffImage };

/** Bigger than any sticker needs; an animated one pays for every frame. */
export const EMOJI_MAX_BYTES = 1024 * 1024;
/** A still larger than this is scaled down; it is shown at a line's height, or 96px in a picker. */
const STILL_MAX_EDGE = 256;


const CATEGORY_MAX = 40;
export function cleanCategory(raw: string | undefined | null): string {
  return (raw ?? "").trim().replace(/\s+/g, " ").slice(0, CATEGORY_MAX);
}



/** An instance address as typed — "example.social" or a full URL — as its origin, or null. */
export function instanceOrigin(ref: string): string | null {
  const url = /^https?:\/\//i.test(ref) ? ref : `https://${ref}`;
  if (!isSafeHttpUrl(url)) return null;
  return new URL(url).origin;
}

/** A Telegram sticker set's name, from the name itself or a t.me/addstickers link. */
export function telegramSetName(ref: string): string | null {
  const match = ref.trim().match(/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/addstickers\/([A-Za-z0-9_]{1,64})\/?$/) ?? ref.trim().match(/^([A-Za-z0-9_]{1,64})$/);
  return match ? match[1]! : null;
}

export interface ServerEmojiView {
  id: string;
  shortcode: string;
  category: string;
  url: string;
  animated: boolean;
  /** A reward: reacted with only by authors who were given it. */
  reward: boolean;
}

/**
 * The server's stickers and custom emoji: one library for everyone,
 * managed by the administrator. Any post may use one as `:shortcode:`,
 * and any reader may react with one. Files are kept here, re-encoded
 * only when a still is larger than it will ever be shown.
 */
export class ServerEmojiService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<ServerEmojiView[]> {
    const rows = await this.prisma.serverEmoji.findMany({
      orderBy: [{ category: "asc" }, { shortcode: "asc" }],
      include: { reward: { select: { id: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      shortcode: row.shortcode,
      category: row.category,
      url: `/emoji/files/${row.storageKey}`,
      animated: row.animated,
      reward: row.reward !== null,
    }));
  }

  async exists(shortcode: string): Promise<boolean> {
    return (await this.prisma.serverEmoji.count({ where: { shortcode } })) > 0;
  }

  async upload(adminId: string, file: { buffer: Buffer; filename: string }, input: { shortcode?: string; category?: string }) {
    const shortcode = toShortcode(input.shortcode?.trim() || file.filename.replace(/\.[^.]+$/, ""));
    if (!shortcode) throw Errors.validation("An alias is letters, digits, _ + and - (it becomes :alias:).");
    if (await this.exists(shortcode)) throw Errors.validation(`:${shortcode}: is already taken.`);
    if (file.buffer.byteLength > EMOJI_MAX_BYTES) throw Errors.validation("A sticker must be 1MB or smaller.");
    const type = sniffImage(file.buffer);
    if (!type) throw Errors.validation("A sticker must be a GIF, PNG, WebP or JPEG image.");

    let buffer = file.buffer;
    let ext = type.ext;
    let mime = type.mime;
    let animated = false;
    try {
      const meta = await sharp(buffer, { animated: true }).metadata();
      animated = (meta.pages ?? 1) > 1;
      const edge = Math.max(meta.width ?? 0, meta.pageHeight ?? meta.height ?? 0);
      if (!animated && edge > STILL_MAX_EDGE) {
        buffer = await sharp(buffer).resize(STILL_MAX_EDGE, STILL_MAX_EDGE, { fit: "inside" }).webp({ quality: 88 }).toBuffer();
        ext = "webp";
        mime = "image/webp";
      }
    } catch {
      throw Errors.validation("That image could not be read.");
    }

    const storageKey = await storageService.save(buffer, ext);
    const row = await this.prisma.serverEmoji.create({
      data: { shortcode, category: cleanCategory(input.category), storageKey, mimeType: mime, animated, sizeBytes: buffer.byteLength, createdById: adminId },
    });
    await logAdminAction(this.prisma, adminId, "EMOJI_ADDED", "ServerEmoji", row.id, { shortcode });
    return row;
  }

  async update(adminId: string, id: string, input: { shortcode?: string; category?: string }) {
    const existing = await this.prisma.serverEmoji.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound("Sticker");
    let shortcode: string | undefined;
    if (input.shortcode !== undefined) {
      shortcode = toShortcode(input.shortcode) ?? undefined;
      if (!shortcode) throw Errors.validation("An alias is letters, digits, _ + and -.");
      if (shortcode !== existing.shortcode && (await this.exists(shortcode))) throw Errors.validation(`:${shortcode}: is already taken.`);
    }
    return this.prisma.serverEmoji.update({
      where: { id },
      data: { shortcode, category: input.category === undefined ? undefined : cleanCategory(input.category) },
    });
  }

  /**
   * A sticker some author was given as a reward stays: they hold it, and
   * react with it. One offered but never given stops being a reward with it.
   */
  private async releaseRewards(ids: string[]) {
    const given = await this.prisma.reward.count({ where: { emojiId: { in: ids }, gifts: { some: {} } } });
    if (given > 0) throw Errors.validation("Authors have been given this sticker as a reward, so it stays. Take it off sale under Rewards instead.");
    await this.prisma.reward.deleteMany({ where: { emojiId: { in: ids } } });
  }

  async remove(adminId: string, id: string) {
    const existing = await this.prisma.serverEmoji.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound("Sticker");
    await this.releaseRewards([id]);
    await this.prisma.serverEmoji.delete({ where: { id } });
    await storageService.delete(existing.storageKey).catch(() => {});
    await logAdminAction(this.prisma, adminId, "EMOJI_REMOVED", "ServerEmoji", id, { shortcode: existing.shortcode });
  }

  /** A whole set, as when an import brought in more than was wanted. */
  async removeCategory(adminId: string, category: string): Promise<number> {
    const rows = await this.prisma.serverEmoji.findMany({ where: { category } });
    await this.releaseRewards(rows.map((r) => r.id));
    await this.prisma.serverEmoji.deleteMany({ where: { category } });
    for (const row of rows) await storageService.delete(row.storageKey).catch(() => {});
    await logAdminAction(this.prisma, adminId, "EMOJI_SET_REMOVED", "ServerEmoji", category, { count: rows.length });
    return rows.length;
  }

  /** Asks the worker to bring in a set; checked here so a typo fails now, not later. */
  async enqueueImport(adminId: string, input: z.infer<typeof importSchema>) {
    let sourceRef = input.sourceRef;
    if (input.source === "SHARKEY") {
      const origin = instanceOrigin(sourceRef);
      if (!origin) throw Errors.validation("Give the instance's address, e.g. https://example.social.");
      sourceRef = origin;
    } else {
      const name = telegramSetName(sourceRef);
      if (!name) throw Errors.validation("Give the sticker set's name or its t.me/addstickers/… link.");
      if (!(await new SettingsService(this.prisma).telegramBotToken())) {
        throw Errors.validation("Telegram import needs a bot token: Admin → Parameters (or TELEGRAM_BOT_TOKEN in .env).");
      }
      sourceRef = name;
    }
    const job = await this.prisma.emojiImportJob.create({
      data: {
        source: input.source,
        sourceRef,
        category: input.category ? cleanCategory(input.category) : null,
        remoteCategories: input.source === "SHARKEY" ? [...new Set(input.remoteCategories ?? [])] : [],
        createdById: adminId,
      },
    });
    await logAdminAction(this.prisma, adminId, "EMOJI_IMPORT_QUEUED", "EmojiImportJob", job.id, {
      source: input.source,
      sourceRef,
      sets: job.remoteCategories.length ? job.remoteCategories.join(", ") : "all",
    });
    return job;
  }

  async listImports() {
    return this.prisma.emojiImportJob.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
  }

  /** Renames a set; one already called that takes its stickers in. */
  async renameCategory(adminId: string, from: string, to: string): Promise<number> {
    const name = to.trim();
    if (!name) throw Errors.validation("Give the set a name.");
    const { count } = await this.prisma.serverEmoji.updateMany({ where: { category: from }, data: { category: name } });
    if (count === 0) throw Errors.notFound("Sticker set");
    await logAdminAction(this.prisma, adminId, "EMOJI_SET_RENAMED", "ServerEmoji", from, { name, count });
    return count;
  }

  /** Clears the finished imports from the list, their logs with them; one still running stays. */
  async clearImports(adminId: string): Promise<number> {
    const { count } = await this.prisma.emojiImportJob.deleteMany({ where: { status: { in: ["DONE", "FAILED"] } } });
    await logAdminAction(this.prisma, adminId, "EMOJI_IMPORTS_CLEARED", "EmojiImportJob", "all", { count });
    return count;
  }

  /**
   * One import's log, a page at a time: every sticker of the source, what
   * it became and, if skipped, why — searchable by name, alias or set.
   */
  async importLog(jobId: string, options: { q?: string; outcome?: string; cursor?: string }) {
    const job = await this.prisma.emojiImportJob.findUnique({ where: { id: jobId } });
    if (!job) throw Errors.notFound("Import");
    const q = options.q?.trim();
    const outcome = (["ADDED", "SKIPPED"] as const).find((o) => o === options.outcome);
    const where: Prisma.EmojiImportLogEntryWhereInput = {
      jobId,
      ...(outcome ? { outcome } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { shortcode: { contains: q, mode: "insensitive" as const } },
              { set: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const page = 100;
    const [rows, added, skipped] = await Promise.all([
      this.prisma.emojiImportLogEntry.findMany({
        where,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: page + 1,
        ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      }),
      this.prisma.emojiImportLogEntry.count({ where: { jobId, outcome: "ADDED" } }),
      this.prisma.emojiImportLogEntry.count({ where: { jobId, outcome: "SKIPPED" } }),
    ]);
    const more = rows.length > page;
    const entries = more ? rows.slice(0, page) : rows;
    return { entries, nextCursor: more ? entries[entries.length - 1]!.id : null, counts: { added, skipped } };
  }
}
