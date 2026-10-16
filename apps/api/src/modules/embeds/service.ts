import type { Redis } from "ioredis";
import { fetchSpotifyCard, fetchSpotifyCover, SpotifyNotFoundError, type SpotifyCard } from "@platform/integrations";
import { spotifyEmbedHeight, spotifyEmbedUrl, spotifyUrl, type SpotifyRef } from "@platform/shared";
import { Errors } from "../../lib/errors.js";
import { sniffImage } from "../../lib/image-mime.js";

/** Swappable for a test, which has no Spotify to talk to. */
export interface SpotifyFetchers {
  card: (pageUrl: string) => Promise<SpotifyCard>;
  cover: (coverUrl: string) => Promise<Buffer>;
}

const defaultFetchers: SpotifyFetchers = {
  card: (pageUrl) => fetchSpotifyCard(pageUrl),
  cover: (coverUrl) => fetchSpotifyCover(coverUrl),
};

const DAY_SECONDS = 24 * 60 * 60;
/** An unknown link is asked about again after ten minutes, not on every page view. */
const MISSING_SECONDS = 10 * 60;

/**
 * Spotify widgets, as this server serves them: the title and cover a
 * reader sees before choosing to load Spotify's player — asked of Spotify
 * by this server, at most once a day per item, so a page view sends the
 * reader's browser nowhere but here.
 */
export class EmbedService {
  constructor(
    private readonly redis: Redis,
    private readonly fetchers: SpotifyFetchers = defaultFetchers,
  ) {}

  private async card(ref: SpotifyRef): Promise<SpotifyCard> {
    const key = `embed:spotify:${ref.kind}:${ref.id}`;
    const cached = await this.redis.get(key);
    if (cached) {
      const parsed = JSON.parse(cached) as SpotifyCard | { missing: true };
      if ("missing" in parsed) throw Errors.notFound("That Spotify item");
      return parsed;
    }
    let card: SpotifyCard;
    try {
      card = await this.fetchers.card(spotifyUrl(ref));
    } catch (err) {
      if (err instanceof SpotifyNotFoundError) {
        await this.redis.set(key, JSON.stringify({ missing: true }), "EX", MISSING_SECONDS);
        throw Errors.notFound("That Spotify item");
      }
      throw Errors.embedUnavailable();
    }
    await this.redis.set(key, JSON.stringify(card), "EX", DAY_SECONDS);
    return card;
  }

  async spotify(ref: SpotifyRef) {
    const card = await this.card(ref);
    return {
      kind: ref.kind,
      id: ref.id,
      title: card.title,
      hasCover: card.coverUrl !== null,
      url: spotifyUrl(ref),
      embedUrl: spotifyEmbedUrl(ref),
      height: spotifyEmbedHeight(ref.kind),
    };
  }

  /** The cover's bytes, kept a day, and only ever a picture. */
  async spotifyCover(ref: SpotifyRef): Promise<{ bytes: Buffer; mime: string }> {
    const key = `embed:spotify-cover:${ref.kind}:${ref.id}`;
    let bytes = await this.redis.getBuffer(key);
    if (!bytes) {
      const card = await this.card(ref);
      if (!card.coverUrl) throw Errors.notFound("Cover");
      try {
        bytes = await this.fetchers.cover(card.coverUrl);
      } catch {
        throw Errors.notFound("Cover");
      }
      await this.redis.set(key, bytes, "EX", DAY_SECONDS);
    }
    const type = sniffImage(bytes);
    if (!type) throw Errors.notFound("Cover");
    return { bytes, mime: type.mime };
  }
}
