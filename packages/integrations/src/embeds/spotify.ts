import { safeFetch } from "../feed/safe-fetch.js";
import { assertPublicHttpUrl } from "../feed/ssrf-guard.js";

/**
 * What Spotify says about a track, album or playlist, read by the server so
 * a reader's browser contacts Spotify only once they choose to load the
 * player: the title and the cover, from Spotify's public oEmbed endpoint
 * (no key, no account).
 */
export interface SpotifyCard {
  title: string;
  /** Spotify's own image address — only ever one of its image hosts. */
  coverUrl: string | null;
}

export class SpotifyNotFoundError extends Error {}

const OEMBED_ENDPOINT = "https://open.spotify.com/oembed";
const MAX_COVER_BYTES = 2 * 1024 * 1024;

/** Spotify serves covers from these hosts; nothing else is fetched as one. */
export function isSpotifyCoverUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port || url.username || url.password) return false;
  return url.hostname === "i.scdn.co" || url.hostname.endsWith(".scdn.co") || url.hostname.endsWith(".spotifycdn.com");
}

interface Options {
  /** Overridable for a test's stub server. */
  endpoint?: string;
  guard?: (url: string) => Promise<void>;
  /** For a test: lets a stub on localhost stand in for Spotify's image hosts. */
  coverCheck?: (url: string) => boolean;
}

/** `pageUrl` is the canonical open.spotify.com address, built by the caller from a parsed link. */
export async function fetchSpotifyCard(pageUrl: string, options: Options = {}): Promise<SpotifyCard> {
  const endpoint = options.endpoint ?? OEMBED_ENDPOINT;
  const res = await safeFetch(
    `${endpoint}?url=${encodeURIComponent(pageUrl)}`,
    { headers: { accept: "application/json" }, timeoutMs: 8000 },
    options.guard ?? assertPublicHttpUrl,
  );
  if (res.status === 404 || res.status === 400) throw new SpotifyNotFoundError("Spotify does not know that link.");
  if (!res.ok) throw new Error(`Spotify answered ${res.status}.`);
  const body = (await res.json()) as { title?: unknown; thumbnail_url?: unknown };
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 300) : "";
  const cover = typeof body.thumbnail_url === "string" ? body.thumbnail_url : null;
  const coverCheck = options.coverCheck ?? isSpotifyCoverUrl;
  return { title, coverUrl: cover && coverCheck(cover) ? cover : null };
}

/** The cover's bytes, for this server to hand on — capped, and only from Spotify's image hosts. */
export async function fetchSpotifyCover(coverUrl: string, options: Options = {}): Promise<Buffer> {
  const coverCheck = options.coverCheck ?? isSpotifyCoverUrl;
  if (!coverCheck(coverUrl)) throw new SpotifyNotFoundError("Not a Spotify image.");
  const res = await safeFetch(coverUrl, { timeoutMs: 8000 }, options.guard ?? assertPublicHttpUrl);
  if (!res.ok) throw new SpotifyNotFoundError(`Spotify's image host answered ${res.status}.`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_COVER_BYTES) throw new Error("That cover is too large.");
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.byteLength > MAX_COVER_BYTES) throw new Error("That cover is too large.");
  return bytes;
}
