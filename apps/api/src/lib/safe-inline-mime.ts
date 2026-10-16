/**
 * The only MIME types a post attachment is ever served with
 * `Content-Disposition: inline` — deliberately an allowlist, not "block
 * known-dangerous types," so a variant we didn't think to name (SVG,
 * `text/html`, `application/xhtml+xml`, ...) fails safe as a forced
 * download instead of risking inline rendering/script execution in the
 * browser. Post attachments accept any file type on upload (spec: "any
 * type"), so this only controls how it's served back, never what's
 * accepted in.
 */
export const SAFE_INLINE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/ogg",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/mp4",
  "audio/webm",
]);
