"use client";

import { useState } from "react";
import type { AchievementProgress } from "@platform/shared";
import { useLocale } from "./locale-provider";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

/**
 * How many earned badges show before the rest fold behind "+N". The
 * highest tiers go first, so what is on view is what is worth seeing.
 */
const VISIBLE_BADGES = 6;

function BadgeChip({ tier, family }: { tier: { id: string; rank: number }; family: string }) {
  const { t } = useLocale();
  const [noIcon, setNoIcon] = useState(false);
  const label = t(`ach.${tier.id.toUpperCase()}` as TranslationKey);
  return (
    <span className="ach-badge" data-family={family} data-rank={tier.rank} data-label={label} role="img" aria-label={label} tabIndex={0}>
      {noIcon ? (
        <span aria-hidden="true">{label.charAt(0)}</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/achievements/${tier.id}.png`} alt="" width={18} height={18} loading="lazy" onError={() => setNoIcon(true)} />
      )}
    </span>
  );
}

/**
 * The author's earned badges as a strip of small round icons next to their
 * handle — a picture each, the name on hover or focus. Only families they
 * have actually reached appear, so a new author's line is just the handle.
 */
export function AchievementBadges({ achievements }: { achievements: AchievementProgress[] }) {
  const { t } = useLocale();
  const [all, setAll] = useState(false);
  const earned = achievements
    .flatMap(({ earned: tier, family }) => (tier ? [{ tier, family }] : []))
    .sort((a, b) => b.tier.rank - a.tier.rank);
  if (earned.length === 0) return null;

  const shown = all ? earned : earned.slice(0, VISIBLE_BADGES);
  const hidden = earned.length - VISIBLE_BADGES;
  return (
    <span className="ach-strip" role="group" aria-label={t("ach.title")}>
      {shown.map(({ tier, family }) => (
        <BadgeChip key={family} tier={tier} family={family} />
      ))}
      {hidden > 0 && (
        <button
          type="button"
          className="ach-badge ach-badge-more"
          aria-expanded={all}
          aria-label={t(all ? "ach.showLess" : "ach.showAll")}
          onClick={() => setAll((open) => !open)}
        >
          {all ? "−" : `+${hidden}`}
        </button>
      )}
    </span>
  );
}
