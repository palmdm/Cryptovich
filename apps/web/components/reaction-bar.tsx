"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, API_URL } from "@/lib/api";
import { loadOwnedRewards, loadServerEmoji } from "@/lib/server-emoji";
import { EmojiPicker } from "./emoji-picker";
import { useLocale } from "./locale-provider";
import { useSession } from "./session-provider";
import { PlusIcon, UsersIcon } from "./icons";
import { ReactorsModal } from "./reactors-modal";

export interface ReactionSummary {
  counts: { emoji: string; count: number }[];
  mine: string[];
}

/**
 * A reaction as it is shown: a Unicode emoji as itself, a server sticker
 * (`:alias:`) as its picture. A sticker the server no longer has falls
 * back to its alias as text rather than a broken image.
 */
export function ReactionGlyph({ value, stickers }: { value: string; stickers: Record<string, string> }) {
  const [broken, setBroken] = useState(false);
  const shortcode = value.startsWith(":") && value.endsWith(":") ? value.slice(1, -1) : null;
  const url = shortcode ? stickers[shortcode] : undefined;
  if (!shortcode) return <span className="reaction-emoji">{value}</span>;
  if (!url || broken) return <span className="reaction-emoji reaction-missing">{value}</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="reaction-sticker"
      src={`${API_URL}${url}`}
      alt={value}
      title={value}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

/**
 * Reactions are free on every post, locked or not — the API never gates
 * them behind EntitlementService, so this renders the same for a reader
 * who hasn't bought the post as for one who has. Placing one needs no
 * account either: a signed-out reader is remembered by a cookie the API
 * hands their browser.
 */
export function ReactionBar({ productId, initial }: { productId: string; initial: ReactionSummary }) {
  const { t } = useLocale();
  const { user } = useSession();
  const [peopleOpen, setPeopleOpen] = useState(false);
  const closePeople = useCallback(() => setPeopleOpen(false), []);
  const [summary, setSummary] = useState<ReactionSummary>(initial);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerBelow, setPickerBelow] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [stickers, setStickers] = useState<Record<string, string>>({});
  // Reward stickers, and the ones this reader holds: a reward pill they
  // cannot add to says so rather than being a button that does nothing.
  const [rewards, setRewards] = useState<{ all: ReadonlySet<string>; held: ReadonlySet<string> }>({ all: new Set(), held: new Set() });
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => setSummary(initial), [initial]);

  // Only when a sticker is actually shown or about to be picked: most
  // posts carry none, and the list is one request for the whole page.
  const needsStickers = pickerOpen || peopleOpen || summary.counts.some((c) => c.emoji.startsWith(":"));
  useEffect(() => {
    if (!needsStickers) return;
    let cancelled = false;
    Promise.all([loadServerEmoji(), loadOwnedRewards(user?.id)]).then(([list, held]) => {
      if (cancelled) return;
      setStickers(Object.fromEntries(list.map((e) => [e.shortcode, e.url])));
      setRewards({ all: new Set(list.filter((e) => e.reward).map((e) => e.shortcode)), held });
    });
    return () => {
      cancelled = true;
    };
  }, [needsStickers, user?.id]);

  useEffect(() => {
    if (!pickerOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setPickerOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPickerOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [pickerOpen]);

  /**
   * The picker opens above the button — unless that would run it under the
   * header or off the top of the screen (a post near the top of the page)
   * and there is more room below.
   */
  function togglePicker() {
    if (!pickerOpen) {
      const rect = wrapRef.current?.querySelector(".reaction-add")?.getBoundingClientRect();
      if (rect) {
        const header = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--topbar-h")) || 56;
        const needed = Math.min(window.innerHeight * 0.6, 420) + 12;
        const above = rect.top - header;
        const below = window.innerHeight - rect.bottom;
        setPickerBelow(above < needed && below > above);
      }
    }
    setPickerOpen((v) => !v);
  }

  async function toggle(emoji: string) {
    if (busy) return;
    setBusy(emoji);
    try {
      setSummary(await apiFetch<ReactionSummary>(`/products/${productId}/reactions`, {
        method: "POST",
        body: JSON.stringify({ emoji }),
      }));
    } catch {
      // A reaction that didn't stick is not worth an error banner over
      // the post — the unchanged count is the feedback.
    } finally {
      setBusy(null);
      setPickerOpen(false);
    }
  }

  return (
    <div className="reaction-bar" ref={wrapRef}>
      {summary.counts.map(({ emoji, count }) => {
        const isMine = summary.mine.includes(emoji);
        const shortcode = emoji.startsWith(":") && emoji.endsWith(":") ? emoji.slice(1, -1) : null;
        const locked = !isMine && shortcode !== null && rewards.all.has(shortcode) && !rewards.held.has(shortcode);
        return (
          <button
            key={emoji}
            type="button"
            className={`reaction-pill${isMine ? " is-mine" : ""}${locked ? " is-locked" : ""}`}
            onClick={() => !locked && toggle(emoji)}
            disabled={busy !== null}
            aria-disabled={locked || undefined}
            title={locked ? t("reactions.rewardOnly") : t("reactions.toggle")}
          >
            <ReactionGlyph value={emoji} stickers={stickers} />
            <span className="reaction-count">{count}</span>
          </button>
        );
      })}

      <div className="reaction-picker-wrap">
        <button
          type="button"
          className={`reaction-pill reaction-add${pickerOpen ? " is-open" : ""}`}
          onClick={togglePicker}
          aria-expanded={pickerOpen}
          aria-label={t("reactions.add")}
          title={t("reactions.add")}
        >
          <PlusIcon size={15} />
        </button>
        {pickerOpen && (
          <div className={`reaction-picker${pickerBelow ? " is-below" : ""}`}>
            <EmojiPicker onPick={toggle} onClose={() => setPickerOpen(false)} />
          </div>
        )}
      </div>

      {summary.counts.length > 0 && (
        <button
          type="button"
          className="reaction-people"
          onClick={() => setPeopleOpen(true)}
          aria-haspopup="dialog"
          title={t("reactors.open")}
          aria-label={t("reactors.open")}
        >
          <UsersIcon size={15} />
        </button>
      )}
      {peopleOpen && (
        <ReactorsModal productId={productId} counts={summary.counts} stickers={stickers} onClose={closePeople} />
      )}
    </div>
  );
}
