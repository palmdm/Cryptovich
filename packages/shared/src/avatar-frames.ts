/**
 * Decorative frames an author may put around their avatar. They are drawn
 * by the web app in CSS/SVG — no image files, so nothing here is a third
 * party's artwork — and the choice is only this name, which the API stores
 * and the fediverse never sees.
 */
export const AVATAR_FRAMES = ["autumn", "sakura", "frost", "laurel", "neon", "cat"] as const;

export type AvatarFrame = (typeof AVATAR_FRAMES)[number];

export function isAvatarFrame(value: unknown): value is AvatarFrame {
  return typeof value === "string" && (AVATAR_FRAMES as readonly string[]).includes(value);
}

/*
 * An author's own frame. Still drawn by the web app, never a picture: it
 * is a recipe — a ring style, two colours, a thickness, an ornament and
 * whether it turns — written into the same `avatarFrame` field as a
 * preset's name, so every surface that already carries the name carries
 * this too. The format is strict (hex colours, words from fixed lists),
 * so nothing an author types reaches the drawing except as those values.
 */
export const CUSTOM_FRAME_STYLES = ["solid", "gradient", "double", "dashed", "dotted", "glow"] as const;
export const CUSTOM_FRAME_ORNAMENTS = ["none", "stars", "hearts", "dots", "ears"] as const;

export interface CustomFrame {
  style: (typeof CUSTOM_FRAME_STYLES)[number];
  /** Six hex digits, lower case, no "#". */
  from: string;
  to: string;
  width: 1 | 2 | 3;
  ornament: (typeof CUSTOM_FRAME_ORNAMENTS)[number];
  spin: boolean;
}

/** The whole recipe, anchored — what `avatarFrame` must match to be one. */
export const CUSTOM_FRAME_PATTERN = new RegExp(
  `^custom:(${CUSTOM_FRAME_STYLES.join("|")}):([0-9a-f]{6}):([0-9a-f]{6}):([123]):(${CUSTOM_FRAME_ORNAMENTS.join("|")}):([01])$`,
);

export function parseCustomFrame(value: unknown): CustomFrame | null {
  if (typeof value !== "string") return null;
  const match = CUSTOM_FRAME_PATTERN.exec(value);
  if (!match) return null;
  return {
    style: match[1] as CustomFrame["style"],
    from: match[2]!,
    to: match[3]!,
    width: Number(match[4]) as CustomFrame["width"],
    ornament: match[5] as CustomFrame["ornament"],
    spin: match[6] === "1",
  };
}

export function customFrameValue(frame: CustomFrame): string {
  return `custom:${frame.style}:${frame.from}:${frame.to}:${frame.width}:${frame.ornament}:${frame.spin ? 1 : 0}`;
}

/** Anything `avatarFrame` may hold: a preset's name or an author's own recipe. */
export function isFrameValue(value: unknown): value is string {
  return isAvatarFrame(value) || parseCustomFrame(value) !== null;
}
