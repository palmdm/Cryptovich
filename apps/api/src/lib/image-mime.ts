/** A small, deliberately narrow allowlist — avatars only ever accept common
 * web-safe RASTER image formats, both so upload validation is meaningful
 * (not just "any image/*") and so the extension embedded in a stored
 * file's name can be trusted to round-trip back to a correct Content-Type
 * on serve. SVG is deliberately excluded: it's XML that can carry a
 * `<script>`/event-handler payload, and an avatar is served back
 * unauthenticated from this platform's own origin — accepting it would be
 * a stored-XSS vector, not just an image upload. */
export const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export const EXT_TO_MIME: Record<string, string> = Object.fromEntries(Object.entries(MIME_TO_EXT).map(([mime, ext]) => [ext, mime]));

const IMAGE_SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: "image/gif", ext: "gif", test: (b) => b.subarray(0, 3).toString("latin1") === "GIF" },
  { mime: "image/png", ext: "png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/webp", ext: "webp", test: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
  { mime: "image/jpeg", ext: "jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
];

/** What the bytes are — never what the uploader said they are. */
export function sniffImage(buffer: Buffer): { mime: string; ext: string } | null {
  return IMAGE_SIGNATURES.find((t) => t.test(buffer)) ?? null;
}
