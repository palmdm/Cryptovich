import type { FastifyInstance } from "fastify";
import { parseSpotifyUrl } from "@platform/shared";
import { EmbedService, type SpotifyFetchers } from "./service.js";
import { Errors } from "../../lib/errors.js";

export default async function embedRoutes(app: FastifyInstance, options: { spotify?: SpotifyFetchers } = {}) {
  const service = new EmbedService(app.redis, options.spotify);

  // Public, like the posts the widgets sit in.
  app.get("/embeds/spotify", async (request, reply) => {
    const { url } = request.query as { url?: string };
    const ref = typeof url === "string" ? parseSpotifyUrl(url) : null;
    if (!ref) throw Errors.validation("That is not a link to a Spotify track, album, playlist, episode, show or artist.");
    reply.header("Cache-Control", "public, max-age=3600");
    reply.send(await service.spotify(ref));
  });

  // The cover, from here rather than from Spotify: a reader who has not
  // chosen to load the player has not been in touch with Spotify at all.
  app.get("/embeds/spotify/:kind/:id/cover", { logLevel: "warn" }, async (request, reply) => {
    const { kind, id } = request.params as { kind: string; id: string };
    const ref = parseSpotifyUrl(`spotify:${kind}:${id}`);
    if (!ref) throw Errors.notFound("Cover");
    const { bytes, mime } = await service.spotifyCover(ref);
    reply.header("Cache-Control", "public, max-age=86400");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.type(mime).send(bytes);
  });
}
