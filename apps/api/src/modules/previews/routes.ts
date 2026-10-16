import type { FastifyInstance, FastifyReply } from "fastify";
import { PreviewService, type LinkPreview } from "./service.js";

/**
 * Link-preview cards, read by the web server while it renders a page's
 * `<head>`. Public and session-blind on purpose: the card is the same for
 * every reader because it is built for the crawler, who has no session.
 *
 * The web server asks from one address for every visitor, so these get a
 * ceiling of their own rather than sharing the global per-address one —
 * with that, a busy minute of page views would start failing to render
 * cards (and, past it, everything else the web server asks for).
 */
const previewRateLimit = { max: 3000, timeWindow: "1 minute" };

export default async function previewRoutes(app: FastifyInstance) {
  const service = new PreviewService(app.prisma);

  function send(reply: FastifyReply, preview: LinkPreview) {
    // Identical for everyone, and a minute stale is harmless for a card.
    reply.header("Cache-Control", "public, max-age=60").send({ preview });
  }

  // For every page's <head> and robots.txt: is the whole server kept out
  // of search engines?
  app.get("/previews/site", async (_request, reply) => {
    reply.header("Cache-Control", "public, max-age=60").send({ noindex: await service.serverHidden() });
  });

  app.get("/previews/profile/:username", { config: { rateLimit: previewRateLimit } }, async (request, reply) => {
    const { username } = request.params as { username: string };
    send(reply, await service.profile(username));
  });

  app.get("/previews/post/:username/:ref", { config: { rateLimit: previewRateLimit } }, async (request, reply) => {
    const { username, ref } = request.params as { username: string; ref: string };
    send(reply, await service.post(username, ref));
  });

  app.get("/previews/folder/:username/:slug", { config: { rateLimit: previewRateLimit } }, async (request, reply) => {
    const { username, slug } = request.params as { username: string; slug: string };
    send(reply, await service.folder(username, slug));
  });
}
