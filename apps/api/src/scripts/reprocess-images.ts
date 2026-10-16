import { prisma } from "@platform/db";
import { storageService } from "../lib/storage.js";
import { processImage, type ImageKind } from "../lib/image-resize.js";
import { EXT_TO_MIME } from "../lib/image-mime.js";
import sharp from "sharp";
import { ActivityPubService } from "../modules/activitypub/service.js";

/**
 * Re-encodes images that were uploaded before uploads were optimised.
 *
 * New uploads are stored at the size they are shown at (see
 * `lib/image-resize.ts`), but everything already in the store is whatever
 * the author sent — which is where the megabyte avatars came from. This
 * walks the existing rows once and rewrites the ones that get smaller.
 *
 * Deliberately additive: the new file is written under a new key and the
 * row is pointed at it, and the old file is left on disk. Nothing is
 * deleted by a batch job, so a bad run costs disk space rather than an
 * author's avatar. Re-running it is harmless — an already-optimised file
 * does not shrink again, so it is skipped.
 *
 * Run:  docker compose exec api node apps/api/dist/scripts/reprocess-images.js
 *       (add `--dry-run` to see what it would do)
 */

const dryRun = process.argv.includes("--dry-run");
/**
 * `--legacy-only` skips anything already WebP. Everything uploaded since
 * uploads were optimised is WebP, so on a server that has already been
 * through this once the whole run is a database query and nothing else —
 * which is what makes it cheap enough to run on every start.
 */
const legacyOnly = process.argv.includes("--legacy-only");
const LEGACY_MIN_BYTES = 256 * 1024;

function extensionOf(key: string): string {
  return key.split(".").pop()?.toLowerCase() ?? "";
}

function percent(before: number, after: number): string {
  return `${Math.round(100 - (100 * after) / before)}%`;
}

async function streamToBuffer(key: string): Promise<Buffer | null> {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of storageService.readStream(key)) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

interface Candidate {
  key: string;
  kind: ImageKind;
  mimeType: string;
  describe: string;
  apply: (newKey: string, mimeType: string, size: number) => Promise<void>;
}

async function collect(): Promise<Candidate[]> {
  const out: Candidate[] = [];

  const profiles = await prisma.creatorProfile.findMany({
    where: { OR: [{ avatarUrl: { not: null } }, { coverUrl: { not: null } }] },
    include: { user: { select: { username: true } } },
  });

  for (const profile of profiles) {
    for (const [field, kind] of [
      ["avatarUrl", "avatar"],
      ["coverUrl", "cover"],
    ] as const) {
      const url = profile[field];
      // Only files this server stores: an author may have pointed at an
      // image hosted elsewhere, which is not ours to rewrite.
      if (!url || !url.startsWith("/")) continue;
      const key = url.split("/").pop()!;
      const mimeType = EXT_TO_MIME[extensionOf(key)];
      if (!mimeType) continue;

      out.push({
        key,
        kind,
        mimeType,
        describe: `${kind} of @${profile.user.username}`,
        apply: async (newKey) => {
          await prisma.creatorProfile.update({
            where: { id: profile.id },
            data: { [field]: `/${kind === "avatar" ? "avatars" : "covers"}/${newKey}` },
          });
          // A new avatar or header is news to every server that follows
          // this author: tell them, so they fetch the new file.
          await new ActivityPubService(prisma).enqueueProfileUpdate(profile.id).catch(() => 0);
        },
      });
    }
  }

  const attachments = await prisma.postAttachment.findMany({ where: { kind: "IMAGE" } });
  for (const attachment of attachments) {
    out.push({
      key: attachment.storageKey,
      kind: "attachment",
      mimeType: attachment.mimeType,
      describe: `attachment ${attachment.originalFilename}`,
      apply: async (newKey, mimeType, size) => {
        await prisma.postAttachment.update({
          where: { id: attachment.id },
          data: { storageKey: newKey, mimeType, sizeBytes: size },
        });
      },
    });
  }

  return out;
}

/**
 * An avatar or cover stored as an animated WebP — what uploads produced
 * before animated profile images were kept as GIF. Mastodon shows those as
 * a still first frame, so they are converted once, even though the GIF is
 * larger. Read from the file's header, so a still image costs no encode.
 */
async function isAnimatedProfileWebp(candidate: Candidate, original: Buffer): Promise<boolean> {
  if (candidate.kind === "attachment" || candidate.mimeType !== "image/webp") return false;
  try {
    return ((await sharp(original, { animated: true }).metadata()).pages ?? 1) > 1;
  } catch {
    return false;
  }
}

async function main() {
  const candidates = await collect();
  if (!legacyOnly) console.log(`${candidates.length} stored image(s) to look at${dryRun ? " (dry run)" : ""}.`);

  let rewritten = 0;
  let savedBytes = 0;

  for (const candidate of candidates) {
    // On a routine start, WebP is already optimised — except an avatar or
    // cover, which may be an animated WebP that has to become a GIF.
    const profileImage = candidate.kind !== "attachment";
    if (legacyOnly && candidate.mimeType === "image/webp" && !profileImage) continue;

    const original = await streamToBuffer(candidate.key);
    if (!original) {
      if (!legacyOnly) console.warn(`  skipped ${candidate.describe}: ${candidate.key} is not in the store`);
      continue;
    }

    const toGif = await isAnimatedProfileWebp(candidate, original);
    if (legacyOnly && candidate.mimeType === "image/webp" && !toGif) continue;

    // On a routine start only big files are worth the encode: a small
    // legacy image that does not shrink would otherwise be decoded and
    // re-encoded on every boot, for nothing.
    if (legacyOnly && !toGif && original.byteLength < LEGACY_MIN_BYTES) continue;

    let processed: Awaited<ReturnType<typeof processImage>>;
    try {
      processed = await processImage(original, candidate.mimeType, candidate.kind);
    } catch {
      // Stored before uploads were checked byte by byte, and not a picture
      // at all: left exactly as it is, and never handed to the decoder.
      console.warn(`  skipped ${candidate.describe}: ${candidate.key} is not a PNG, JPEG, GIF or WebP image`);
      continue;
    }
    const becameGif = toGif && processed.mimeType === "image/gif";
    if (!becameGif && processed.buffer.byteLength >= original.byteLength) {
      if (!legacyOnly) console.log(`  unchanged ${candidate.describe} (${original.byteLength} bytes, already small enough)`);
      continue;
    }

    console.log(
      `  ${dryRun ? "would rewrite" : "rewriting"} ${candidate.describe}: ` +
        (becameGif
          ? `animated WebP → GIF, so it stays animated on other servers (${original.byteLength} → ${processed.buffer.byteLength} bytes)`
          : `${original.byteLength} → ${processed.buffer.byteLength} bytes (−${percent(original.byteLength, processed.buffer.byteLength)})`),
    );
    savedBytes += Math.max(0, original.byteLength - processed.buffer.byteLength);
    rewritten += 1;

    if (dryRun) continue;
    const newKey = await storageService.save(processed.buffer, processed.extension);
    await candidate.apply(newKey, processed.mimeType, processed.buffer.byteLength);
  }

  // Quiet when there was nothing to do, so a normal start logs nothing.
  if (rewritten > 0 || !legacyOnly) {
    console.log(
      `${dryRun ? "Would rewrite" : "Rewrote"} ${rewritten} image(s), saving ${(savedBytes / (1024 * 1024)).toFixed(1)}MB.` +
        (dryRun ? "" : " The old files are left in place; remove them once you are happy."),
    );
  }
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
