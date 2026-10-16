"use client";

import { apiFetch, API_URL } from "./api";

export interface ServerEmoji {
  id: string;
  shortcode: string;
  category: string;
  url: string;
  animated: boolean;
  /** A reward: offered in a picker only to an author who was given it. */
  reward?: boolean;
}

/**
 * The server's stickers, fetched once for the whole page and shared by
 * everything that needs them: every rendered post body, the reaction
 * picker, the editor's autocomplete. The promise is cached, not only its
 * result, so cards mounting together share one request.
 */
let cached: Promise<ServerEmoji[]> | null = null;

export function loadServerEmoji(): Promise<ServerEmoji[]> {
  cached ??= apiFetch<{ emoji: ServerEmoji[] }>("/emoji/server")
    .then((res) => res.emoji)
    .catch(() => {
      // Not cached as a failure: a later render should be able to retry.
      cached = null;
      return [];
    });
  return cached;
}

/**
 * Where a browser fetches a sticker. The API names its files by its own
 * path (`/emoji/files/<key>`), which on the site is under `/api` — given
 * as it is, a post asked the web server for it and drew a broken image.
 */
export function stickerSrc(url: string): string {
  return url.startsWith("/") && !url.startsWith("//") ? `${API_URL}${url}` : url;
}

/** Their `shortcode → url` map (the API's own paths), which is what rendering a body needs. */
export function loadServerEmojiMap(): Promise<Record<string, string>> {
  return loadServerEmoji().then((list) => Object.fromEntries(list.map((e) => [e.shortcode, e.url])));
}

/**
 * The reward stickers an account holds — given to them as an author — by
 * alias. Fetched once per account per page; a signed-out reader holds none.
 */
let owned: { userId: string; promise: Promise<Set<string>> } | null = null;

export function loadOwnedRewards(userId: string | null | undefined): Promise<Set<string>> {
  if (!userId) return Promise.resolve(new Set());
  if (owned?.userId !== userId) {
    const promise = apiFetch<{ shortcodes: string[] }>("/rewards/owned")
      .then((res) => new Set(res.shortcodes))
      .catch(() => {
        owned = null;
        return new Set<string>();
      });
    owned = { userId, promise };
  }
  return owned.promise;
}

/**
 * What a picker offers this reader: every ordinary sticker, and only the
 * rewards they hold. The API refuses a reaction with any other reward, so
 * offering one would only be a button that fails.
 */
export function usableStickers(all: ServerEmoji[], held: ReadonlySet<string>): ServerEmoji[] {
  return all.filter((s) => !s.reward || held.has(s.shortcode));
}

/** By set, in the order a picker shows them: named sets first, then the rest. */
export function groupByCategory(emoji: ServerEmoji[]): { category: string; emoji: ServerEmoji[] }[] {
  const groups = new Map<string, ServerEmoji[]>();
  for (const item of emoji) {
    const key = item.category || "";
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)))
    .map(([category, list]) => ({ category, emoji: list }));
}
