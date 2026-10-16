import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { APP_NAME } from "@platform/shared";
import { safeFetch } from "@platform/integrations";

/**
 * The site's icon: the favicon, the icons the installed app uses, and the
 * web app manifest that names them.
 *
 * The source is `FAVICON` in .env — an http(s) address or a path to a file
 * the container can read — or, left empty, the built-in Cryptovich mark. It is
 * read once and kept in memory: a favicon is asked for on every first
 * visit, and each request must not reach out to wherever the original
 * lives. Every size is cut from that one source, so the tab, the home
 * screen and the install dialog always show the same picture.
 */

/**
 * The built-in mark: a "C" in a rounded square, in the default theme's
 * blue (Twitter's), struck through like a currency sign (₵).
 *
 * Drawn as strokes, not `<text>`: the API runs on Alpine, which ships no
 * fonts at all, so sharp's renderer drew a word as a speck. Paths render
 * the same everywhere, and one bold letter stays legible at 16 pixels.
 */
const DEFAULT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3aa9f5"/><stop offset="1" stop-color="#0c7abf"/></linearGradient></defs>
  <rect width="512" height="512" rx="112" fill="url(#g)"/>
  <path d="M356 168A132 132 0 1 0 356 344" fill="none" stroke="#ffffff" stroke-width="58" stroke-linecap="round"/>
  <path d="M262 92V420" fill="none" stroke="#ffffff" stroke-width="30" stroke-linecap="round"/>
</svg>`;

export const ICON_SIZES = [32, 48, 180, 192, 512] as const;
export type IconSize = (typeof ICON_SIZES)[number];

export interface IconFile {
  body: Buffer;
  contentType: string;
  etag: string;
}

function etagOf(body: Buffer): string {
  return `"${createHash("sha256").update(body).digest("base64url").slice(0, 27)}"`;
}

/** What the first bytes of an icon say it is. */
function sniff(buffer: Buffer): string | null {
  if (buffer.subarray(0, 4).equals(Buffer.from([0x00, 0x00, 0x01, 0x00]))) return "image/x-icon";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.subarray(0, 3).toString("latin1") === "GIF") return "image/gif";
  if (buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  const head = buffer.subarray(0, 512).toString("utf8").trimStart();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "image/svg+xml";
  return null;
}

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

export class BrandingService {
  private source: Promise<{ buffer: Buffer; type: string }> | null = null;
  private readonly rendered = new Map<string, Promise<IconFile>>();

  constructor(
    readonly configured: string | undefined = process.env.FAVICON,
    private readonly log: { warn: (message: string) => void } = console,
  ) {}

  /** The configured icon, or the built-in one when it is unset or unusable. */
  private loadSource(): Promise<{ buffer: Buffer; type: string }> {
    this.source ??= (async () => {
      const configured = this.configured?.trim();
      if (configured) {
        try {
          const buffer = /^https?:\/\//i.test(configured)
            ? Buffer.from(
                await (async () => {
                  // Through the SSRF guard: the address is typed in the
                  // admin area, and a redirect could point anywhere.
                  const res = await safeFetch(configured, { timeoutMs: 10_000 });
                  if (!res.ok) throw new Error(`HTTP ${res.status}`);
                  return res.arrayBuffer();
                })(),
              )
            : await readFile(configured);
          if (buffer.byteLength > MAX_SOURCE_BYTES) throw new Error("larger than 2MB");
          const type = sniff(buffer);
          if (!type) throw new Error("not an image this can read (use ICO, PNG, SVG, GIF, WebP or JPEG)");
          return { buffer, type };
        } catch (err) {
          this.log.warn(
            `[branding] FAVICON=${configured} could not be used (${err instanceof Error ? err.message : err}); the built-in icon is served instead.`,
          );
        }
      }
      return { buffer: Buffer.from(DEFAULT_SVG), type: "image/svg+xml" };
    })();
    return this.source;
  }

  /** A square PNG of the icon, `size` pixels a side. */
  png(size: IconSize): Promise<IconFile> {
    const key = `png:${size}`;
    let file = this.rendered.get(key);
    if (!file) {
      file = (async () => {
        const { buffer } = await this.loadSource();
        const body = await sharp(buffer, { density: 384 })
          .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png()
          .toBuffer();
        return { body, contentType: "image/png", etag: etagOf(body) };
      })();
      this.rendered.set(key, file);
    }
    return file;
  }

  /**
   * `/favicon.ico`: the configured .ico exactly as it is, and otherwise a
   * 48px PNG — which every browser takes at that address.
   */
  async favicon(): Promise<IconFile> {
    const { buffer, type } = await this.loadSource();
    if (type === "image/x-icon") return { body: buffer, contentType: type, etag: etagOf(buffer) };
    return this.png(48);
  }

  /** The web app manifest: what makes the site installable as an app. */
  manifest(): Record<string, unknown> {
    return {
      name: APP_NAME,
      short_name: APP_NAME,
      description: "Back the authors you read.",
      id: "/",
      start_url: "/",
      scope: "/",
      display: "standalone",
      // The default theme's ground — Twitter's white (a manifest has one
      // colour, not one per scheme; the page's meta tags carry X's black).
      background_color: "#ffffff",
      theme_color: "#ffffff",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    };
  }
}
