import sharp from "sharp";
import { MIME_TO_EXT, sniffImage } from "./image-mime.js";
import { Errors } from "./errors.js";

/**
 * Uploaded images are re-encoded to the size they are actually shown at.
 *
 * What this exists for: an avatar is displayed at 92px and a 2MB animated
 * GIF was being served for it, on every profile, to every reader. The
 * file the author picked is whatever their camera or screen recorder
 * produced; the file this platform serves should not be.
 *
 * Two rules keep it honest:
 *
 *  - The result is only used when it is genuinely smaller. Re-encoding an
 *    already-small, already-optimised image can *grow* it, and a lossy
 *    pass over it would only lose detail for nothing.
 *  - A failure is never an upload failure. Anything sharp cannot read —
 *    an unusual GIF, a truncated file — is stored exactly as it arrived,
 *    which is what happened before this existed.
 */

export interface ProcessedImage {
  buffer: Buffer;
  mimeType: string;
  extension: string;
}

/**
 * The longest edge each kind of image is kept at — tighter for an
 * animation, which pays for its size once per frame. A 30-frame cover at
 * 1600px is 1.4MB; the same cover at 1280px is half that, and it is
 * displayed in a column 920px wide.
 */
const LIMITS = {
  /** Shown at 92px at most, and at 2× for a retina screen. */
  avatar: { still: 512, animated: 384 },
  /** The banner across the top of a profile. */
  cover: { still: 1600, animated: 1280 },
  /** Inside a post, in a column that is 920px at its widest. */
  attachment: { still: 1920, animated: 1280 },
} as const;

export type ImageKind = keyof typeof LIMITS;

/**
 * Mastodon — and most of the fediverse — keeps an avatar or a header
 * animated only when it is a GIF: an animated WebP arrives as its first
 * frame and stays still. So an animated avatar or cover is stored as a
 * GIF, not an animated WebP, even though the WebP would be smaller.
 */
const GIF_WHEN_ANIMATED: ReadonlySet<ImageKind> = new Set(["avatar", "cover"]);
/** Mastodon drops an avatar or header over this, and shows the default. */
export const FEDERATED_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

/**
 * An animation as a GIF, at the longest edge it may have, stepping down
 * until it fits Mastodon's limit. Null when not even the smallest step
 * fits — the caller then falls back to WebP, which at least shows.
 */
async function animatedGif(buffer: Buffer, limit: number): Promise<Buffer | null> {
  for (const scale of [1, 0.8, 0.64, 0.5]) {
    const edge = Math.round(limit * scale);
    const gif = await sharp(buffer, { animated: true, limitInputPixels: 268_402_689 })
      .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
      // Frames that barely differ from the last reuse its pixels, which is
      // most of what makes a screen-recorded GIF large.
      .gif({ effort: 7, interFrameMaxError: 6 })
      .toBuffer();
    if (gif.byteLength <= FEDERATED_IMAGE_MAX_BYTES) return gif;
  }
  return null;
}

function unchanged(buffer: Buffer, mimeType: string): ProcessedImage {
  return { buffer, mimeType, extension: MIME_TO_EXT[mimeType] ?? "png" };
}

/**
 * Downscales and re-encodes to WebP, which is smaller than PNG, JPEG and
 * GIF alike at the same quality and is supported everywhere this app
 * runs. Animation is preserved: an animated post image becomes an
 * animated WebP, typically a fraction of the size — except an avatar or
 * cover, which stays a GIF so it is still animated on other servers
 * (`GIF_WHEN_ANIMATED`).
 */
export async function processImage(buffer: Buffer, declaredMimeType: string, kind: ImageKind): Promise<ProcessedImage> {
  // Not one of the pictures this platform re-encodes (a video, a sound):
  // stored as it came, and served as a download unless its type is safe.
  if (!MIME_TO_EXT[declaredMimeType]) return unchanged(buffer, declaredMimeType);
  // Said to be a picture, so it has to be one — and it is stored as what
  // its bytes are, not as what the upload claimed. An HTML page labelled
  // image/png used to be kept as a .png whenever sharp could not read it.
  const actual = sniffImage(buffer);
  if (!actual) throw Errors.validation("That file is not a PNG, JPEG, GIF or WebP image.");
  const mimeType = actual.mime;

  try {
    const input = sharp(buffer, { animated: true, limitInputPixels: 268_402_689 });
    const meta = await input.metadata();

    const animated = (meta.pages ?? 1) > 1;
    const limit = animated ? LIMITS[kind].animated : LIMITS[kind].still;
    // Motion hides compression artefacts, so an animation can be encoded
    // harder than a still without looking worse.
    const quality = animated ? 78 : 82;

    // `pageHeight` is the height of one frame; `height` is every frame
    // stacked, which is what sharp reports for an animated image.
    const height = meta.pageHeight ?? meta.height ?? 0;
    const width = meta.width ?? 0;
    const needsResize = width > limit || height > limit;

    if (animated && GIF_WHEN_ANIMATED.has(kind)) {
      // An animated GIF that is already small enough and within bounds is
      // kept exactly as sent.
      if (mimeType === "image/gif" && !needsResize && buffer.byteLength <= FEDERATED_IMAGE_MAX_BYTES) {
        return unchanged(buffer, mimeType);
      }
      const gif = await animatedGif(buffer, limit);
      if (gif) return { buffer: gif, mimeType: "image/gif", extension: "gif" };
    }

    const pipeline = sharp(buffer, { animated: true, limitInputPixels: 268_402_689 });
    if (needsResize) {
      pipeline.resize({ width: limit, height: limit, fit: "inside", withoutEnlargement: true });
    }
    const encoded = await pipeline.webp({ quality, effort: 4 }).toBuffer();

    // Only if it actually helped — see the note above.
    if (encoded.byteLength >= buffer.byteLength && !needsResize) return unchanged(buffer, mimeType);

    return { buffer: encoded, mimeType: "image/webp", extension: "webp" };
  } catch {
    return unchanged(buffer, mimeType);
  }
}
