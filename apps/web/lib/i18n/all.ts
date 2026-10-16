import { en } from "./en";
import { ru } from "./ru";
import { ja } from "./ja";
import type { Dictionary, Locale } from "./dictionaries";

/**
 * Every language at once — for the server (the service worker embeds
 * them as data) and tests. Never import this from a client component:
 * that puts all three back into every page (see `loadDictionary`).
 */
export const dictionaries: Record<Locale, Dictionary> = { en, ru, ja };
