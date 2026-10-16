"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { QUICK_REACTIONS } from "@platform/shared";
import { API_URL } from "@/lib/api";
import { loadEmojiData, searchEmoji, type EmojiData, type UnicodeEmoji } from "@/lib/emoji-search";
import { groupByCategory, loadOwnedRewards, loadServerEmoji, usableStickers, type ServerEmoji } from "@/lib/server-emoji";
import { useLocale } from "./locale-provider";
import { useSession } from "./session-provider";
import { CloseIcon, SearchIcon } from "./icons";

const RECENT_KEY = "platform_recent_emoji";
const RECENT_MAX = 32;

/** What a pick is: a Unicode emoji, or a server sticker as `:alias:`. */
export type PickedEmoji = string;

function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberEmoji(value: string) {
  try {
    const next = [value, ...readRecent().filter((v) => v !== value)].slice(0, RECENT_MAX);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Private mode: the row is simply empty next time.
  }
}

/** A sticker whose file has gone shows its alias rather than a broken image. */
function StickerImage({ sticker, size = 28 }: { sticker: ServerEmoji; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <span className="picker-missing">:{sticker.shortcode}:</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`${API_URL}${sticker.url}`}
      alt={`:${sticker.shortcode}:`}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

/**
 * One picker for everything: reacting to a post or an announcement, and
 * inserting into the editor. Search runs over the whole Unicode set (by
 * English name) and over the server's stickers (by alias); below it are
 * the ones this reader used lately, the server's sticker sets by set, and
 * the emoji groups. The bar at the foot names whatever is under the
 * pointer, which is how a reader learns a sticker's `:alias:`.
 */
export function EmojiPicker({ onPick, onClose }: { onPick: (value: PickedEmoji) => void; onClose?: () => void }) {
  const { t } = useLocale();
  const { user } = useSession();
  const [query, setQuery] = useState("");
  const [library, setLibrary] = useState<ServerEmoji[]>([]);
  const [held, setHeld] = useState<ReadonlySet<string>>(new Set());
  const [emojiData, setEmojiData] = useState<EmojiData | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [openSets, setOpenSets] = useState<Record<string, boolean>>({});
  const [hovered, setHovered] = useState<{ label: string; sticker?: ServerEmoji } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadServerEmoji().then(setLibrary).catch(() => {});
    // The Unicode set is fetched when the picker opens, not with the page.
    loadEmojiData().then(setEmojiData).catch(() => {});
    setRecent(readRecent());
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadOwnedRewards(user?.id).then((codes) => !cancelled && setHeld(codes));
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const stickers = useMemo(() => usableStickers(library, held), [library, held]);
  const rewards = useMemo(() => stickers.filter((s) => s.reward), [stickers]);
  const byShortcode = useMemo(() => new Map(stickers.map((s) => [s.shortcode, s])), [stickers]);
  const sets = useMemo(() => groupByCategory(stickers.filter((s) => !s.reward)), [stickers]);
  const q = query.trim().toLowerCase();
  const foundStickers = useMemo(
    () => (q ? stickers.filter((s) => s.shortcode.includes(q) || s.category.toLowerCase().includes(q)).slice(0, 80) : []),
    [q, stickers],
  );
  const foundEmoji = useMemo(() => (q && emojiData ? searchEmoji(emojiData.all, q) : []), [q, emojiData]);

  function pick(value: string) {
    rememberEmoji(value);
    setRecent(readRecent());
    onPick(value);
  }

  function emojiButton(item: UnicodeEmoji) {
    return (
      <button
        key={item.emoji}
        type="button"
        className="picker-cell"
        title={item.name}
        onMouseEnter={() => setHovered({ label: item.name })}
        onFocus={() => setHovered({ label: item.name })}
        onClick={() => pick(item.emoji)}
      >
        {item.emoji}
      </button>
    );
  }

  function stickerButton(sticker: ServerEmoji) {
    return (
      <button
        key={sticker.id}
        type="button"
        className="picker-cell"
        title={`:${sticker.shortcode}:`}
        onMouseEnter={() => setHovered({ label: `:${sticker.shortcode}:`, sticker })}
        onFocus={() => setHovered({ label: `:${sticker.shortcode}:`, sticker })}
        onClick={() => pick(`:${sticker.shortcode}:`)}
      >
        <StickerImage sticker={sticker} />
      </button>
    );
  }

  /** A recent entry is either a sticker that still exists, or an emoji. */
  function recentButton(value: string) {
    const shortcode = value.startsWith(":") && value.endsWith(":") ? value.slice(1, -1) : null;
    if (shortcode) {
      const sticker = byShortcode.get(shortcode);
      return sticker ? stickerButton(sticker) : null;
    }
    return (
      <button
        key={value}
        type="button"
        className="picker-cell"
        onMouseEnter={() => setHovered({ label: value })}
        onClick={() => pick(value)}
      >
        {value}
      </button>
    );
  }

  return (
    <div className="emoji-picker" role="dialog" aria-label={t("picker.open")}>
      <div className="picker-search">
        <SearchIcon size={16} />
        <input
          ref={searchRef}
          type="search"
          value={query}
          placeholder={t("picker.search")}
          aria-label={t("picker.search")}
          onChange={(e) => setQuery(e.target.value)}
        />
        {onClose && (
          <button type="button" aria-label={t("picker.close")} title={t("picker.close")} onClick={onClose}>
            <CloseIcon size={16} />
          </button>
        )}
      </div>

      <div className="picker-scroll">
        {q ? (
          <>
            {foundStickers.length === 0 && foundEmoji.length === 0 && <p className="meta picker-empty">{t("picker.nothing")}</p>}
            {foundStickers.length > 0 && (
              <>
                <div className="picker-heading">{t("picker.stickers")}</div>
                <div className="picker-grid">{foundStickers.map(stickerButton)}</div>
              </>
            )}
            {foundEmoji.length > 0 && (
              <>
                <div className="picker-heading">{t("picker.emoji")}</div>
                <div className="picker-grid">{foundEmoji.map(emojiButton)}</div>
              </>
            )}
          </>
        ) : (
          <>
            <div className="picker-grid picker-quick">
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="picker-cell"
                  onMouseEnter={() => setHovered({ label: emoji })}
                  onClick={() => pick(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>

            {rewards.length > 0 && (
              <>
                <div className="picker-heading">{t("picker.rewards")}</div>
                <div className="picker-grid">{rewards.map(stickerButton)}</div>
              </>
            )}

            {recent.length > 0 && (
              <>
                <div className="picker-heading">{t("picker.recent")}</div>
                <div className="picker-grid">{recent.map(recentButton)}</div>
              </>
            )}

            {sets.length > 0 && <div className="picker-heading">{t("picker.stickers")}</div>}
            {sets.map(({ category, emoji }) => {
              const label = category || t("picker.ungrouped");
              const isOpen = openSets[label] ?? sets.length <= 2;
              return (
                <div key={label}>
                  <button
                    type="button"
                    className="picker-set"
                    aria-expanded={isOpen}
                    onClick={() => setOpenSets((prev) => ({ ...prev, [label]: !isOpen }))}
                  >
                    <span>
                      {label} <span className="meta">({emoji.length})</span>
                    </span>
                    <span aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                  </button>
                  {isOpen && <div className="picker-grid">{emoji.map(stickerButton)}</div>}
                </div>
              );
            })}

            <div className="picker-heading">{t("picker.emoji")}</div>
            {(emojiData?.groups ?? []).map((group) => (
              <div key={group.group}>
                <div className="picker-subheading">{group.group}</div>
                <div className="picker-grid">{group.emoji.map(emojiButton)}</div>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="picker-preview" aria-hidden="true">
        {hovered?.sticker ? <StickerImage sticker={hovered.sticker} size={32} /> : <span className="picker-preview-emoji">{hovered?.label ?? ""}</span>}
        {hovered?.sticker && <span className="picker-preview-name">{hovered.label}</span>}
      </div>
    </div>
  );
}
