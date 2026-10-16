/**
 * Author achievements, defined once and shared by the API that computes
 * them and the UI that renders them.
 *
 * Every achievement is derived from facts the database already holds —
 * published posts, active subscribers, settled tips, answered comments,
 * months since joining. Nothing is stored: a counter kept alongside the
 * rows it counts is a counter that eventually disagrees with them, and
 * "you have 12 posts" next to a page showing 11 is worse than no badge.
 *
 * Tiers ascend within a family, and only the highest reached is shown —
 * a page listing bronze, silver and gold for the same thing is noise.
 */
export type AchievementFamily =
  | "POSTS"
  | "SUBSCRIBERS"
  | "TIPS"
  | "CONVERSATION"
  | "TENURE"
  | "FEDERATION"
  | "REACTIONS"
  | "VIEWS"
  | "SALES"
  | "FOLLOWERS"
  | "PINNED"
  | "COLLECTIONS";

export interface AchievementTier {
  id: string;
  family: AchievementFamily;
  /** What the author's measured value must reach. */
  threshold: number;
  /** 1-based rank inside its family, for rendering weight. */
  rank: number;
}

export interface AchievementProgress {
  /** The highest tier reached, or null when none is. */
  earned: AchievementTier | null;
  /** The next tier up, or null at the top of the family. */
  next: AchievementTier | null;
  family: AchievementFamily;
  value: number;
}

const tiers = (family: AchievementFamily, thresholds: number[]): AchievementTier[] =>
  thresholds.map((threshold, index) => ({
    id: `${family.toLowerCase()}_${index + 1}`,
    family,
    threshold,
    rank: index + 1,
  }));

export const ACHIEVEMENTS: AchievementTier[] = [
  ...tiers("POSTS", [1, 10, 50, 200]),
  ...tiers("SUBSCRIBERS", [1, 10, 100, 1000]),
  // Minor units, so 1000 = $10. Kept in the same integer units as every
  // other amount here rather than converted for display.
  ...tiers("TIPS", [1000, 10_000, 100_000]),
  ...tiers("CONVERSATION", [10, 100, 1000]),
  // Whole months since the account was created.
  ...tiers("TENURE", [1, 6, 12, 36]),
  ...tiers("FEDERATION", [1]),
  // Reactions readers left on this author's posts.
  ...tiers("REACTIONS", [10, 100, 1000]),
  // Times a post of theirs was opened.
  ...tiers("VIEWS", [100, 1000, 10_000, 100_000]),
  // Settled purchases of their posts, files and bundles.
  ...tiers("SALES", [1, 10, 100]),
  // Accounts following them from another fediverse server.
  ...tiers("FOLLOWERS", [1, 10, 100]),
  // Posts kept at the top of their page.
  ...tiers("PINNED", [1]),
  // Sections and folders they have arranged their page into.
  ...tiers("COLLECTIONS", [1, 5]),
];

/**
 * The highest tier reached in each family plus the next one up, given the
 * author's measured values. A family left out of `values` counts as zero,
 * so a caller may measure only what it cares about. Families the author
 * has not started are omitted entirely rather than shown at zero — an
 * empty profile should look empty, not like a list of failures.
 */
export function evaluateAchievements(values: Partial<Record<AchievementFamily, number>>): AchievementProgress[] {
  const families = [...new Set(ACHIEVEMENTS.map((a) => a.family))];

  return families
    .map((family) => {
      const value = values[family] ?? 0;
      const inFamily = ACHIEVEMENTS.filter((a) => a.family === family).sort((a, b) => a.threshold - b.threshold);
      const reached = inFamily.filter((a) => value >= a.threshold);
      return {
        family,
        value,
        earned: reached.length > 0 ? reached[reached.length - 1]! : null,
        next: inFamily.find((a) => value < a.threshold) ?? null,
      };
    })
    .filter((progress) => progress.earned !== null);
}
