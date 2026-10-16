import {
  siApplemusic,
  siArtstation,
  siBandcamp,
  siBehance,
  siBilibili,
  siBluesky,
  siBoosty,
  siBuymeacoffee,
  siCodeberg,
  siDeviantart,
  siDiscord,
  siDribbble,
  siFacebook,
  siGithub,
  siGitlab,
  siGoodreads,
  siHabr,
  siHuggingface,
  siInstagram,
  siItchdotio,
  siKaggle,
  siKick,
  siKofi,
  siLemmy,
  siLetterboxd,
  siMastodon,
  siMatrix,
  siMedium,
  siMisskey,
  siNiconico,
  siNpm,
  siOdnoklassniki,
  siPatreon,
  siPeertube,
  siPinterest,
  siPixelfed,
  siPixiv,
  siReddit,
  siSignal,
  siSnapchat,
  siSoundcloud,
  siSpotify,
  siStackoverflow,
  siSteam,
  siSubstack,
  siTelegram,
  siThreads,
  siTiktok,
  siTumblr,
  siTwitch,
  siVimeo,
  siVk,
  siWhatsapp,
  siX,
  siYoutube,
  type SimpleIcon,
} from "simple-icons";
import { LinkIcon } from "./icons";

/**
 * Which service a link goes to, by its host: the domain itself, or one
 * under it (`name.bandcamp.com`). Fediverse servers have no one domain, so
 * a few common ones are named and the rest are recognised by the `/@name`
 * shape of a profile address.
 */
const BY_HOST: [string[], SimpleIcon][] = [
  [["github.com", "github.io"], siGithub],
  [["gitlab.com"], siGitlab],
  [["codeberg.org"], siCodeberg],
  [["youtube.com", "youtu.be"], siYoutube],
  [["twitch.tv"], siTwitch],
  [["kick.com"], siKick],
  [["t.me", "telegram.me", "telegram.org"], siTelegram],
  [["vk.com", "vk.ru", "vkvideo.ru"], siVk],
  [["x.com", "twitter.com"], siX],
  [["bsky.app"], siBluesky],
  [["instagram.com"], siInstagram],
  [["threads.net", "threads.com"], siThreads],
  [["tiktok.com"], siTiktok],
  [["discord.gg", "discord.com"], siDiscord],
  [["reddit.com"], siReddit],
  [["facebook.com", "fb.com"], siFacebook],
  [["patreon.com"], siPatreon],
  [["boosty.to"], siBoosty],
  [["ko-fi.com"], siKofi],
  [["buymeacoffee.com"], siBuymeacoffee],
  [["spotify.com"], siSpotify],
  [["music.apple.com"], siApplemusic],
  [["soundcloud.com"], siSoundcloud],
  [["bandcamp.com"], siBandcamp],
  [["pixiv.net"], siPixiv],
  [["deviantart.com"], siDeviantart],
  [["artstation.com"], siArtstation],
  [["behance.net"], siBehance],
  [["dribbble.com"], siDribbble],
  [["steamcommunity.com", "steampowered.com"], siSteam],
  [["itch.io"], siItchdotio],
  [["habr.com"], siHabr],
  [["medium.com"], siMedium],
  [["substack.com"], siSubstack],
  [["matrix.to"], siMatrix],
  [["pinterest.com"], siPinterest],
  [["vimeo.com"], siVimeo],
  [["ok.ru"], siOdnoklassniki],
  [["wa.me", "whatsapp.com"], siWhatsapp],
  [["signal.me", "signal.group"], siSignal],
  [["tumblr.com"], siTumblr],
  [["npmjs.com"], siNpm],
  [["stackoverflow.com"], siStackoverflow],
  [["kaggle.com"], siKaggle],
  [["huggingface.co"], siHuggingface],
  [["letterboxd.com"], siLetterboxd],
  [["goodreads.com"], siGoodreads],
  [["snapchat.com"], siSnapchat],
  [["bilibili.com"], siBilibili],
  [["nicovideo.jp"], siNiconico],
  [["mastodon.social", "mastodon.online", "mstdn.social", "mastodon.ml"], siMastodon],
  [["misskey.io"], siMisskey],
  [["pixelfed.social"], siPixelfed],
];

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** The service behind a link, or null for an ordinary site. */
export function serviceFor(url: string): SimpleIcon | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  for (const [domains, icon] of BY_HOST) if (domains.some((d) => hostMatches(host, d))) return icon;
  // Software by the server's own name.
  if (/(^|\.)(mastodon|mstdn)\b/.test(host)) return siMastodon;
  if (/(^|\.)(misskey|sharkey)\b/.test(host)) return siMisskey;
  if (/(^|\.)pixelfed\b/.test(host)) return siPixelfed;
  if (/(^|\.)(peertube|tube)\b/.test(host)) return siPeertube;
  if (/(^|\.)lemmy\b/.test(host)) return siLemmy;
  // Any other fediverse profile: /@name.
  if (/^\/@[\w.-]+\/?$/.test(parsed.pathname)) return siMastodon;
  return null;
}

/**
 * The mark in front of an author's link: the service's own logo, drawn in
 * the text's colour (one ink in every theme), or the plain link icon.
 */
export function ServiceIcon({ url, size = 15 }: { url: string; size?: number }) {
  const service = serviceFor(url);
  if (!service) return <LinkIcon size={size} />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d={service.path} />
    </svg>
  );
}

/** The service's name for the link's tooltip, if it is one. */
export function serviceName(url: string): string | null {
  return serviceFor(url)?.title ?? null;
}
