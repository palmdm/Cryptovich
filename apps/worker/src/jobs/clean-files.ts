import { prisma } from "@platform/db";
import { storageFromEnv, type StorageBackend } from "@platform/integrations";

/** Nothing younger is touched: an upload a post has not been saved with yet, a copy being written. */
const GRACE_MS = 24 * 60 * 60 * 1000;
/** Moscow time, when the server is quietest for the readers it was built for. */
const HOUR_MSK = 22;
const MARKER = "filesCleanedOn";

/** `/avatars/<key>` or `/covers/<key>` — a picture this server stores. */
const UPLOADED_PATH = /^\/(?:avatars|covers)\/([^/?#]+)$/;

export interface CleanResult {
  attachmentsRemoved: number;
  filesRemoved: number;
  bytesFreed: number;
}

/**
 * Every stored file something still names: a profile's avatar and cover,
 * a post's cover, a subscription tier's picture, a post's attachments, a
 * file sold as a product, a folder's uploads, the server's stickers. A
 * new kind of stored picture must be added here, or the clean-up takes it. A file is kept if any row
 * names it — a draft's, a disabled post's — so the clean-up removes only
 * what nothing can show again.
 */
async function referencedKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  const fromPath = (value: string | null) => {
    const match = value?.match(UPLOADED_PATH);
    if (match) keys.add(match[1]!);
  };
  const [profiles, products, attachments, files, folderItems, emoji, tiers] = await Promise.all([
    prisma.creatorProfile.findMany({ select: { avatarUrl: true, coverUrl: true } }),
    prisma.digitalProduct.findMany({ where: { coverUrl: { not: null } }, select: { coverUrl: true } }),
    prisma.postAttachment.findMany({ select: { storageKey: true } }),
    prisma.digitalFile.findMany({ select: { storageKey: true } }),
    prisma.folderItem.findMany({ where: { storageKey: { not: null } }, select: { storageKey: true } }),
    prisma.serverEmoji.findMany({ select: { storageKey: true } }),
    prisma.subscriptionTier.findMany({ where: { imageUrl: { not: null } }, select: { imageUrl: true } }),
  ]);
  for (const p of profiles) {
    fromPath(p.avatarUrl);
    fromPath(p.coverUrl);
  }
  for (const p of products) fromPath(p.coverUrl);
  for (const tier of tiers) fromPath(tier.imageUrl);
  for (const row of [...attachments, ...files, ...emoji]) keys.add(row.storageKey);
  for (const item of folderItems) if (item.storageKey) keys.add(item.storageKey);
  return keys;
}

/**
 * The nightly clean-up. First the attachments of posts deleted more than
 * a day ago — rows and files — then every stored file that nothing names
 * any more and that is more than a day old: pictures left from an avatar
 * or a cover that was replaced, older copies the image re-encoder made
 * new ones of, uploads never attached to a post.
 */
export async function cleanFiles(options: { now?: Date; storage?: StorageBackend; graceMs?: number } = {}): Promise<CleanResult> {
  const now = options.now ?? new Date();
  const storage = options.storage ?? storageFromEnv();
  const before = new Date(now.getTime() - (options.graceMs ?? GRACE_MS));
  const result: CleanResult = { attachmentsRemoved: 0, filesRemoved: 0, bytesFreed: 0 };

  const dead = await prisma.postAttachment.findMany({
    where: { post: { product: { deletedAt: { lt: before } } } },
    select: { id: true },
  });
  if (dead.length) {
    result.attachmentsRemoved = (await prisma.postAttachment.deleteMany({ where: { id: { in: dead.map((a) => a.id) } } })).count;
  }

  if (!storage.list) return result;
  const keep = await referencedKeys();
  for await (const file of storage.list()) {
    if (keep.has(file.key) || file.modifiedAt >= before) continue;
    await storage.delete(file.key);
    result.filesRemoved += 1;
    result.bytesFreed += file.size;
  }
  return result;
}

/** The hour and the date in Moscow, whatever the server's own time zone. */
function moscow(now: Date): { hour: number; date: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { hour: Number(parts.hour), date: `${parts.year}-${parts.month}-${parts.day}` };
}

/**
 * Once a day, from 22:00 Moscow time: the first tick in that hour (or any
 * later one that day, should the worker have been down) runs it, and a
 * marker row keeps the next ticks from repeating it.
 */
export async function cleanFilesWhenDue(now = new Date()): Promise<CleanResult | null> {
  const { hour, date } = moscow(now);
  if (hour < HOUR_MSK) return null;
  const done = await prisma.serverSetting.findUnique({ where: { key: MARKER } });
  if (done?.value === date) return null;
  await prisma.serverSetting.upsert({ where: { key: MARKER }, create: { key: MARKER, value: date }, update: { value: date } });
  return cleanFiles({ now });
}
