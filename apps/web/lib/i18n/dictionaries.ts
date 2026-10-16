import { en, type TranslationKey } from "./en";

export type { TranslationKey };
export { en };
export type Dictionary = Record<TranslationKey, string>;

export type Locale = "en" | "ru" | "ja";

export const LOCALES: Locale[] = ["en", "ru", "ja"];

/**
 * Flags label the switcher because they are recognisable at a glance at
 * the size the control actually is; the language's own name is kept
 * alongside so the choice never rests on a flag alone.
 */
/** Each language by its own name; its flag is drawn by `components/flag.tsx`. */
export const LOCALE_META: Record<Locale, { name: string }> = {
  en: { name: "English" },
  ru: { name: "Русский" },
  ja: { name: "日本語" },
};

/**
 * English is in the bundle: it is what the server renders and what a
 * missing key falls back to. Russian and Japanese are fetched when chosen
 * — every page used to carry all three, 57 KB of the 70 KB (gzipped) the
 * shared layout adds. All three at once is `./all` (server-side only).
 *
 * ru.ts and ja.ts are each typed as a complete `Record<TranslationKey,
 * string>`, so adding a key to `en` still breaks the build until both
 * are updated.
 */
const loaders: Record<Exclude<Locale, "en">, () => Promise<Dictionary>> = {
  ru: () => import("./ru").then((m) => m.ru),
  ja: () => import("./ja").then((m) => m.ja),
};

const loaded = new Map<Locale, Promise<Dictionary>>([["en", Promise.resolve(en)]]);

/** The dictionary for `locale`, fetched once; a failed fetch is retried next time. */
export function loadDictionary(locale: Locale): Promise<Dictionary> {
  let pending = loaded.get(locale);
  if (!pending) {
    pending = loaders[locale as Exclude<Locale, "en">]().catch((err: unknown) => {
      loaded.delete(locale);
      throw err;
    });
    loaded.set(locale, pending);
  }
  return pending;
}
