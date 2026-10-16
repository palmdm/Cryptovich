"use client";

import { useEffect, useState } from "react";
import { spotifyEmbedHeight, spotifyEmbedUrl, spotifyUrl, type SpotifyKind, type SpotifyRef } from "@platform/shared";
import { apiFetch, ApiError, API_URL } from "@/lib/api";
import { useLocale } from "./locale-provider";
import { MusicIcon, PlayIcon } from "./icons";

interface SpotifyCardData {
  kind: SpotifyKind;
  id: string;
  title: string;
  hasCover: boolean;
  embedUrl: string;
  height: number;
}

const ALWAYS_KEY = "platform_spotify_always";

/** One request per item per page, however many times it appears. */
const cards = new Map<string, Promise<SpotifyCardData | "missing" | "unavailable">>();

function loadCard(ref: SpotifyRef) {
  const key = `${ref.kind}:${ref.id}`;
  let pending = cards.get(key);
  if (!pending) {
    pending = apiFetch<SpotifyCardData>(`/embeds/spotify?url=${encodeURIComponent(spotifyUrl(ref))}`).catch((err) => {
      cards.delete(key);
      return err instanceof ApiError && err.status === 404 ? ("missing" as const) : ("unavailable" as const);
    });
    cards.set(key, pending);
  }
  return pending;
}

function readAlways(): boolean {
  try {
    return window.localStorage.getItem(ALWAYS_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Spotify's player — after the reader asks for it. Until then this is a
 * card drawn here, with the title and cover this server read from
 * Spotify, so opening a page tells Spotify nothing. One click loads the
 * real player in place; "always" remembers that choice in this browser.
 */
export function SpotifyEmbed({ spotify }: { spotify: SpotifyRef }) {
  const { t } = useLocale();
  const [card, setCard] = useState<SpotifyCardData | "missing" | "unavailable" | null>(null);
  const [load, setLoad] = useState(false);
  const [always, setAlways] = useState(false);
  const height = spotifyEmbedHeight(spotify.kind);
  const compact = height < 200;

  useEffect(() => {
    if (readAlways()) setLoad(true);
    let cancelled = false;
    loadCard(spotify).then((result) => !cancelled && setCard(result));
    return () => {
      cancelled = true;
    };
  }, [spotify]);

  const data = card && typeof card === "object" ? card : null;
  const title = data?.title || t("spotify.untitled");

  if (load && card !== "missing") {
    return (
      <iframe
        className="spotify-player"
        src={data?.embedUrl ?? spotifyEmbedUrl(spotify)}
        title={`Spotify: ${title}`}
        height={height}
        loading="lazy"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      />
    );
  }

  function start() {
    if (always) {
      try {
        window.localStorage.setItem(ALWAYS_KEY, "1");
      } catch {
        // Not remembered; the player still loads now.
      }
    }
    setLoad(true);
  }

  return (
    <div className={`spotify-card${compact ? " is-compact" : ""}`} style={{ minHeight: height }}>
      <div className="spotify-cover">
        {data?.hasCover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`${API_URL}/embeds/spotify/${spotify.kind}/${spotify.id}/cover`} alt="" loading="lazy" />
        ) : (
          <MusicIcon size={compact ? 36 : 56} />
        )}
      </div>
      <div className="spotify-text">
        <span className="spotify-kind">
          {t(`spotify.kind.${spotify.kind}`)} · Spotify
        </span>
        <strong className="spotify-title">{card === null ? "…" : title}</strong>
        {card === "missing" ? (
          <span className="spotify-note">{t("spotify.missing")}</span>
        ) : (
          <>
            <div className="spotify-actions">
              <button type="button" className="spotify-play" onClick={start} aria-label={t("spotify.load")} title={t("spotify.load")}>
                <PlayIcon size={22} />
              </button>
              <span className="spotify-note">{card === "unavailable" ? t("spotify.unavailable") : t("spotify.privacy")}</span>
            </div>
            <label className="spotify-always">
              <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} />
              {t("spotify.always")}
            </label>
          </>
        )}
        <a className="spotify-open" href={spotifyUrl(spotify)} target="_blank" rel="noopener noreferrer">
          {t("spotify.open")}
        </a>
      </div>
    </div>
  );
}
