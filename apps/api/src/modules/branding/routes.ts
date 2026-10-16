import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { BrandingService, ICON_SIZES, type IconFile, type IconSize } from "./service.js";
import { SettingsService } from "../settings/service.js";

/**
 * The site's icons and manifest. The web server forwards `/favicon.ico`,
 * `/icon-192.png`, `/apple-touch-icon.png` and `/manifest.webmanifest` here
 * path for path, so the browser — and any WAF or proxy in front — sees
 * ordinary same-origin files at the root, with caching headers a proxy can
 * keep.
 */
export default async function brandingRoutes(app: FastifyInstance) {
  const settings = new SettingsService(app.prisma);
  const log = { warn: (m: string) => app.log.warn(m) };
  let drawn: BrandingService | null = null;

  // The `favicon` setting as it is now: an icon saved in the admin area
  // replaces the drawn sizes on its next request (FAVICON in .env until then).
  async function current(): Promise<BrandingService> {
    const configured = await settings.favicon();
    if (!drawn || drawn.configured !== configured) drawn = new BrandingService(configured, log);
    return drawn;
  }

  function send(request: FastifyRequest, reply: FastifyReply, file: IconFile) {
    // A day fresh, then served stale while it revalidates: a changed
    // FAVICON shows within a day without every visit asking again.
    reply
      .header("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800")
      .header("ETag", file.etag)
      .header("X-Content-Type-Options", "nosniff");
    if (request.headers["if-none-match"] === file.etag) return reply.code(304).send();
    return reply.header("Content-Type", file.contentType).send(file.body);
  }

  app.get("/branding/favicon.ico", async (request, reply) => send(request, reply, await (await current()).favicon()));

  app.get("/branding/icon/:size", async (request, reply) => {
    const size = Number((request.params as { size: string }).size.replace(/\.png$/, ""));
    if (!ICON_SIZES.includes(size as IconSize)) return reply.code(404).send();
    return send(request, reply, await (await current()).png(size as IconSize));
  });

  app.get("/branding/manifest.webmanifest", async (_request, reply) => {
    reply
      .header("Content-Type", "application/manifest+json; charset=utf-8")
      .header("Cache-Control", "public, max-age=3600")
      .send((await current()).manifest());
  });
}
