export const THEME_STORAGE_KEY = "platform_theme";

/**
 * Every theme the stylesheet defines a token block for, plus "system".
 *
 * "system" is the absence of a choice: it writes no attribute at all and
 * lets the stylesheet's `prefers-color-scheme` query pick between the two
 * defaults — Twitter by day, X by night — so following the OS costs no
 * JavaScript. Every other value is
 * stamped onto `<html data-theme>` and matches a `:root[data-theme="…"]`
 * block in globals.css — add one here and you must add the other.
 */
export const THEMES = [
  "system",
  "twitter",
  "light_colorblind",
  "x_dark",
  "dark",
  "dark_high_contrast",
  "dark_colorblind",
  "glass_light",
  "glass_dark",
  "wc3_human",
  "wc3_orc",
  "wc3_night_elf",
  "wc3_undead",
  "vk_classic",
] as const;

export type Theme = (typeof THEMES)[number];

/** The explicit ones — "system" is deliberately not among them. */
export const EXPLICIT_THEMES = THEMES.filter((t) => t !== "system") as readonly Exclude<Theme, "system">[];

/** Twitter and X come first: they are what a reader sees until they choose. */
export const LIGHT_THEMES: readonly Theme[] = ["twitter", "light_colorblind"];
export const DARK_THEMES: readonly Theme[] = ["x_dark", "dark", "dark_high_contrast", "dark_colorblind"];
/** Translucent, blurred surfaces — one light, one dark. */
export const GLASS_THEMES: readonly Theme[] = ["glass_light", "glass_dark"];
/** A period piece: VKontakte as it looked before its 2016 redesign. */
export const RETRO_THEMES: readonly Theme[] = ["vk_classic"];
/** One per Warcraft III faction, after the wc3ui reference palettes. */
export const WC3_THEMES: readonly Theme[] = ["wc3_human", "wc3_orc", "wc3_night_elf", "wc3_undead"];

/** The groups the theme pickers render, in the order they show them. */
export const THEME_GROUPS: readonly { labelKey: "theme.groupLight" | "theme.groupDark" | "theme.groupGlass" | "theme.groupWc3" | "theme.groupRetro"; themes: readonly Theme[] }[] = [
  { labelKey: "theme.groupLight", themes: LIGHT_THEMES },
  { labelKey: "theme.groupDark", themes: DARK_THEMES },
  { labelKey: "theme.groupGlass", themes: GLASS_THEMES },
  { labelKey: "theme.groupWc3", themes: WC3_THEMES },
  { labelKey: "theme.groupRetro", themes: RETRO_THEMES },
];

/**
 * The two colours each theme is recognised by: its ground and its accent.
 *
 * The switcher paints them as one circle split along a diagonal, which is
 * what lets a dozen themes sit in a header in any language — the old menu
 * listed translated names, and the Russian ones did not fit.
 *
 * These are literal values, not tokens: every swatch has to show *its own*
 * palette while a different theme is active.
 */
export const THEME_SWATCHES: Record<Exclude<Theme, "system">, readonly [string, string]> = {
  twitter: ["#ffffff", "#1d9bf0"],
  light_colorblind: ["#ffffff", "#0969da"],
  dark: ["#0d1117", "#238636"],
  dark_high_contrast: ["#010409", "#09b43a"],
  dark_colorblind: ["#0d1117", "#388bfd"],
  x_dark: ["#000000", "#1d9bf0"],
  glass_light: ["#eef2f9", "#0a84ff"],
  glass_dark: ["#12151c", "#0a84ff"],
  wc3_human: ["#2a2a3a", "#6db3f2"],
  wc3_orc: ["#2a1f1a", "#ff6644"],
  wc3_night_elf: ["#1a2a2a", "#44ffcc"],
  wc3_undead: ["#1a1a2a", "#8866ff"],
  vk_classic: ["#ffffff", "#597da3"],
};

/**
 * Themes that no longer exist, and what a reader who had chosen one gets
 * instead — rewritten in storage before first paint, so nobody who picked
 * the old light theme on a dark device wakes up to X.
 */
export const RETIRED_THEMES: Readonly<Record<string, Exclude<Theme, "system">>> = {
  light: "twitter",
  light_high_contrast: "twitter",
  dark_dimmed: "dark",
};

/**
 * Runs before first paint to stamp an explicit theme choice onto <html>,
 * so a reader who forced a theme never sees a frame of the wrong one.
 *
 * It has to be inline: an external file would load *after* first paint,
 * which is the flash this exists to prevent. The CSP forbids inline
 * script without a nonce or a hash, and a nonce would mean reading
 * per-request headers in the root layout — which opts every page out of
 * static prerendering. The hash below costs nothing and keeps them
 * static. `'strict-dynamic'` ignores host allowlists but still honours
 * hashes, which is why this works at all.
 *
 * Built from EXPLICIT_THEMES rather than hardcoding the list twice, so a
 * new theme cannot be added to the app but forgotten here.
 */
export const THEME_INIT_SCRIPT =
  `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");` +
  `var r=${JSON.stringify(RETIRED_THEMES)};if(r[t]){t=r[t];localStorage.setItem("${THEME_STORAGE_KEY}",t)}` +
  `if(${JSON.stringify(EXPLICIT_THEMES)}.indexOf(t)>-1){document.documentElement.setAttribute("data-theme",t)}}catch(e){}})()`;

/**
 * The `'sha256-…'` source expression that lets the script above run.
 *
 * Hardcoded rather than computed: middleware runs on the Edge runtime,
 * which has no `node:crypto`, and hashing per request to derive a
 * constant would be wasted work. `csp.test.ts` recomputes it from
 * THEME_INIT_SCRIPT and fails if the two ever drift, so changing the
 * script — including by adding a theme — is a failing test rather than a
 * silently blocked script.
 */
export const THEME_INIT_SCRIPT_CSP_HASH = "'sha256-5CKunA90ws2Ac12BTCztr7p6mTDRD4nure2EG2gC95U='";
