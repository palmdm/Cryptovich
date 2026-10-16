/**
 * Spotify links, as an author pastes them: open.spotify.com/{kind}/{id}
 * (with or without an /intl-xx/ prefix, an /embed/ prefix or ?si=…) or a
 * spotify:{kind}:{id} URI. Everything else is not a Spotify link — the
 * parsing is strict because what comes out is turned into the address of
 * a frame and of a server-side request.
 */
export const SPOTIFY_KINDS = ["track", "album", "playlist", "episode", "show", "artist"] as const;

export type SpotifyKind = (typeof SPOTIFY_KINDS)[number];

export interface SpotifyRef {
  kind: SpotifyKind;
  /** Base62, 22 characters — Spotify's own id format. */
  id: string;
}

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;

function isKind(value: string | undefined): value is SpotifyKind {
  return (SPOTIFY_KINDS as readonly string[]).includes(value ?? "");
}

export function parseSpotifyUrl(value: string): SpotifyRef | null {
  const text = value.trim();
  const uri = /^spotify:([a-z]+):([A-Za-z0-9]+)$/.exec(text);
  if (uri) return isKind(uri[1]) && SPOTIFY_ID.test(uri[2]!) ? { kind: uri[1], id: uri[2]! } : null;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "open.spotify.com" || url.port || url.username || url.password) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0]?.startsWith("intl-")) parts.shift();
  if (parts[0] === "embed") parts.shift();
  if (parts.length !== 2) return null;
  const [kind, id] = parts;
  return isKind(kind) && SPOTIFY_ID.test(id!) ? { kind, id: id! } : null;
}

/** The page on Spotify, in its canonical form. */
export function spotifyUrl(ref: SpotifyRef): string {
  return `https://open.spotify.com/${ref.kind}/${ref.id}`;
}

/** Spotify's own player for it, for an iframe. */
export function spotifyEmbedUrl(ref: SpotifyRef): string {
  return `https://open.spotify.com/embed/${ref.kind}/${ref.id}`;
}

/**
 * The height Spotify's player is drawn at: a single track or episode as
 * the compact strip (cover, title, play), anything with a list — an
 * album, a playlist — as the tall square-covered player.
 */
export function spotifyEmbedHeight(kind: SpotifyKind): number {
  return kind === "track" || kind === "episode" ? 152 : 352;
}
