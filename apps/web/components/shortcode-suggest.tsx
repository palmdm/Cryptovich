"use client";

import { useEffect, useMemo, useState } from "react";
import { API_URL } from "@/lib/api";
import { loadEmojiData, searchEmoji, type UnicodeEmoji } from "@/lib/emoji-search";
import { loadOwnedRewards, loadServerEmoji, usableStickers, type ServerEmoji } from "@/lib/server-emoji";
import { useLocale } from "./locale-provider";
import { useSession } from "./session-provider";

export interface Suggestion {
  /** What gets inserted: `:alias:` or the emoji itself. */
  value: string;
  label: string;
  url?: string;
}

/** The `:partial` the caret sits at the end of, if any. */
export function shortcodeAtCaret(text: string, caret: number): { query: string; from: number } | null {
  const before = text.slice(0, caret);
  const match = before.match(/(?:^|[\s(])(:([a-z0-9_+-]{1,40}))$/i);
  if (!match) return null;
  return { query: match[2]!.toLowerCase(), from: caret - match[1]!.length };
}

/** Stickers first — they are what a shortcode is usually for — then emoji. */
export function suggestFor(query: string, stickers: ServerEmoji[], allEmoji: UnicodeEmoji[] = []): Suggestion[] {
  if (query.length < 1) return [];
  const fromStickers = stickers
    .filter((s) => s.shortcode.includes(query))
    .sort((a, b) => Number(b.shortcode.startsWith(query)) - Number(a.shortcode.startsWith(query)))
    .slice(0, 8)
    .map((s) => ({ value: `:${s.shortcode}:`, label: `:${s.shortcode}:`, url: s.url }));
  const fromEmoji = searchEmoji(allEmoji, query, 8).map((e) => ({ value: e.emoji, label: `${e.emoji} ${e.name}` }));
  return [...fromStickers, ...fromEmoji].slice(0, 12);
}

/**
 * The list that drops under the caret while an author is typing a
 * `:shortcode`. Arrow keys and Enter are handled by the editor, which owns
 * the textarea; this only draws the list and reports a click.
 */
export function ShortcodeSuggest({
  query,
  active,
  onPick,
  onCount,
}: {
  query: string;
  active: number;
  onPick: (value: string) => void;
  onCount: (suggestions: Suggestion[]) => void;
}) {
  const { t } = useLocale();
  const { user } = useSession();
  const [stickers, setStickers] = useState<ServerEmoji[]>([]);
  const [allEmoji, setAllEmoji] = useState<UnicodeEmoji[]>([]);

  useEffect(() => {
    // Rewards only for an author who holds them, as in the picker.
    Promise.all([loadServerEmoji(), loadOwnedRewards(user?.id)])
      .then(([all, held]) => setStickers(usableStickers(all, held)))
      .catch(() => {});
  }, [user?.id]);

  useEffect(() => {
    // Only once an author actually types a `:` — never with the page.
    loadEmojiData()
      .then((data) => setAllEmoji(data.all))
      .catch(() => {});
  }, []);

  const suggestions = useMemo(() => suggestFor(query, stickers, allEmoji), [query, stickers, allEmoji]);

  useEffect(() => {
    onCount(suggestions);
  }, [suggestions, onCount]);

  if (suggestions.length === 0) return null;

  return (
    <ul className="shortcode-suggest" role="listbox" aria-label={t("editor.suggestions")}>
      {suggestions.map((s, index) => (
        <li key={s.value}>
          <button
            type="button"
            role="option"
            aria-selected={index === active}
            className={index === active ? "is-active" : undefined}
            onMouseDown={(e) => {
              // Before the textarea loses focus, so the caret is still where it was.
              e.preventDefault();
              onPick(s.value);
            }}
          >
            {s.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`${API_URL}${s.url}`} alt="" width={22} height={22} />
            ) : (
              <span className="shortcode-suggest-emoji">{s.value}</span>
            )}
            <span className="shortcode-suggest-label">{s.label}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
