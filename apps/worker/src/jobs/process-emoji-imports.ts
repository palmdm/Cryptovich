import { prisma } from "@platform/db";
import {
  assertPublicHttpUrl,
  safeFetch,
  SharkeyStickerProvider,
  storageFromEnv,
  TelegramStickerProvider,
  type StickerProvider,
  type StorageBackend,
} from "@platform/integrations";
import { toShortcode } from "@platform/shared";
import { parameter } from "../lib/parameters.js";

const MAX_BYTES = 1024 * 1024;
const MAX_PER_IMPORT = 3000;
/** Misskey/Sharkey expose every custom emoji as one synthetic pack. */
const SHARKEY_ALL = "custom-emoji";

type Job = Awaited<ReturnType<typeof prisma.emojiImportJob.findFirstOrThrow>>;

async function defaultProvider(job: Job): Promise<StickerProvider> {
  if (job.source === "TELEGRAM") {
    const token = await parameter("telegramBotToken");
    if (!token) throw new Error("Telegram import needs a bot token: Admin → Parameters (or TELEGRAM_BOT_TOKEN in .env).");
    return new TelegramStickerProvider(token);
  }
  return new SharkeyStickerProvider(job.sourceRef);
}

/** The picture formats a sticker may be, read from the bytes. */
function imageType(bytes: Buffer): { mime: string; ext: string; animated: boolean } | null {
  const text = bytes.subarray(0, Math.min(bytes.length, 4096)).toString("latin1");
  if (text.startsWith("GIF")) return { mime: "image/gif", ext: "gif", animated: bytes.includes(Buffer.from("NETSCAPE2.0")) };
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: "image/png", ext: "png", animated: text.includes("acTL") };
  }
  if (text.startsWith("RIFF") && text.slice(8, 12) === "WEBP") return { mime: "image/webp", ext: "webp", animated: text.includes("ANIM") };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { mime: "image/jpeg", ext: "jpeg", animated: false };
  return null;
}

async function download(url: string, guard: (u: string) => Promise<void>): Promise<Buffer | null> {
  const res = await safeFetch(url, { timeoutMs: 15_000 }, guard);
  if (!res.ok || !res.body) return null;
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) return null;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > MAX_BYTES) return null;
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Carries out sticker imports the administrator queued: fetches the set
 * (a fediverse instance's chosen categories, or a Telegram set),
 * downloads each picture (through the SSRF guard, 1MB at most), and adds
 * it to the server's library under its own alias. An alias already taken
 * is skipped, not overwritten; so is anything that is not a picture — a
 * Telegram animated (Lottie) or video sticker. One job at a time: an
 * import can be thousands of files.
 */
export async function processEmojiImports(
  options: { provider?: (job: Job) => StickerProvider; guard?: (url: string) => Promise<void>; storage?: StorageBackend } = {},
): Promise<number> {
  const job = await prisma.emojiImportJob.findFirst({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" } });
  if (!job) return 0;
  await prisma.emojiImportJob.update({ where: { id: job.id }, data: { status: "RUNNING" } });

  const guard = options.guard ?? assertPublicHttpUrl;
  const storage = options.storage ?? storageFromEnv();
  let imported = 0;
  let skipped = 0;
  // The log, written in batches with the counts: every sticker of the
  // source, added or skipped and why, for the administrator to read.
  type Entry = { name: string; shortcode: string | null; set: string | null; outcome: "ADDED" | "SKIPPED"; reason: string | null };
  let pending: Entry[] = [];
  const note = (entry: Entry) => {
    pending.push(entry);
    if (entry.outcome === "ADDED") imported += 1;
    else skipped += 1;
  };
  const flush = async () => {
    if (pending.length) await prisma.emojiImportLogEntry.createMany({ data: pending.map((e) => ({ ...e, jobId: job.id })) });
    pending = [];
    await prisma.emojiImportJob.update({ where: { id: job.id }, data: { importedCount: imported, skippedCount: skipped } });
  };

  try {
    const provider = await (options.provider ?? defaultProvider)(job);
    const pack = await provider.importPack(job.source === "SHARKEY" ? SHARKEY_ALL : job.sourceRef);
    const sourceUrl = job.source === "TELEGRAM" ? `https://t.me/addstickers/${job.sourceRef}` : job.sourceRef;
    // A fediverse instance is many sets; the administrator chose which.
    const wanted = new Set(job.remoteCategories);
    const stickers = wanted.size ? pack.stickers.filter((item) => wanted.has(item.category?.trim() ?? "")) : pack.stickers;
    // An instance's ungrouped emoji are named after the instance, not
    // "Custom emoji on https://…".
    const fallbackSet = job.source === "SHARKEY" ? new URL(job.sourceRef).hostname : pack.title;

    for (const [position, item] of stickers.entries()) {
      // Telegram names a sticker by its emoji, which is no alias; those
      // are numbered within their set instead, and can be renamed later.
      const shortcode =
        job.source === "TELEGRAM" ? toShortcode(`${pack.externalId}_${position + 1}`) : toShortcode(item.name);
      const set = (job.category || item.category || fallbackSet || "").trim().slice(0, 40);
      const skip = (reason: string) => note({ name: item.name, shortcode: shortcode || null, set: set || null, outcome: "SKIPPED", reason });
      if (position >= MAX_PER_IMPORT) skip("OVER_LIMIT");
      else if (!shortcode) skip("BAD_NAME");
      else if (item.kind === "VIDEO") skip("VIDEO");
      else if ((await prisma.serverEmoji.count({ where: { shortcode } })) > 0) skip("ALIAS_TAKEN");
      else {
        const bytes = await download(item.url, guard).catch(() => null);
        const type = bytes ? imageType(bytes) : null;
        if (!bytes) skip("DOWNLOAD_FAILED");
        else if (!type) skip("NOT_A_PICTURE");
        else {
          const storageKey = await storage.save(bytes, type.ext);
          await prisma.serverEmoji.create({
            data: {
              shortcode,
              category: set,
              storageKey,
              mimeType: type.mime,
              animated: type.animated,
              sizeBytes: bytes.byteLength,
              sourceUrl,
              createdById: job.createdById,
            },
          });
          note({ name: item.name, shortcode, set: set || null, outcome: "ADDED", reason: null });
        }
      }
      if (pending.length >= 50) await flush();
    }
    await flush();
    await prisma.emojiImportJob.update({
      where: { id: job.id },
      data: { status: "DONE", importedCount: imported, skippedCount: skipped, error: null },
    });
  } catch (err) {
    await flush().catch(() => undefined);
    await prisma.emojiImportJob.update({
      where: { id: job.id },
      data: { status: "FAILED", importedCount: imported, skippedCount: skipped, error: err instanceof Error ? err.message.slice(0, 500) : "Import failed." },
    });
  }
  return 1;
}
