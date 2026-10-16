"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { type Dictionary, type Locale, type TranslationKey, LOCALES, en, loadDictionary } from "@/lib/i18n/dictionaries";
import { setApiMessageTranslator } from "@/lib/api";
import { translateApiMessage } from "@/lib/api-messages";

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /**
   * `vars` fills `{name}` placeholders. Typing the key means a typo is a
   * compile error rather than a raw key rendered to the reader.
   */
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  /**
   * A counted noun in the reader's own grammar: `tn("profile.postsCount", 1)`
   * reads "1 пост", `tn(…, 3)` "3 поста", `tn(…, 7)` "7 постов".
   *
   * English needs two forms and Russian four, so the form is chosen by
   * `Intl.PluralRules` rather than by an `n === 1` check — which is what
   * produced "1 постов" everywhere a count was shown.
   */
  tn: (baseKey: string, count: number, vars?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: "en",
  setLocale: () => {},
  t: (key) => key,
  tn: (baseKey) => baseKey,
});

const STORAGE_KEY = "platform_locale";

/** The language chosen before, else the browser's if it is one of ours. */
function preferredLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && LOCALES.includes(stored as Locale)) return stored as Locale;
  } catch {
    // Storage blocked: fall through to the browser's language.
  }
  const browserLang = navigator.language.slice(0, 2);
  return LOCALES.includes(browserLang as Locale) ? (browserLang as Locale) : "en";
}

// The reader's dictionary starts downloading as soon as this module runs,
// alongside hydration rather than after it.
if (typeof window !== "undefined") loadDictionary(preferredLocale()).catch(() => {});

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");
  // The active language's strings, switched together with `locale`.
  const dictionaryRef = useRef<Dictionary>(en);
  // The last language asked for: an earlier, slower download must not win.
  const wantedRef = useRef<Locale>("en");

  const switchTo = useCallback((next: Locale) => {
    wantedRef.current = next;
    loadDictionary(next)
      .then((dictionary) => {
        if (wantedRef.current !== next) return;
        dictionaryRef.current = dictionary;
        setLocaleState(next);
      })
      // Offline with the chunk not cached: stay in the current language.
      .catch(() => {});
  }, []);

  useEffect(() => {
    const preferred = preferredLocale();
    if (preferred !== "en") switchTo(preferred);
  }, [switchTo]);

  const setLocale = useCallback(
    (next: Locale) => {
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Not remembered, but still switched for this visit.
      }
      switchTo(next);
    },
    [switchTo],
  );

  /**
   * `t` keeps the same identity for the life of the app, reading the
   * current locale through a ref rather than closing over it.
   *
   * That is not a micro-optimisation. Pages load their data in an effect
   * whose dependency list includes `t` (it is used to translate the
   * failure message), and the locale is read from storage *after* the
   * first render — so a `t` that changed with the locale re-ran every one
   * of those effects. The profile page fetched its eleven endpoints
   * twice on every visit, and the post-impression counter was posted
   * twice, inflating the figure authors are shown.
   *
   * Consumers still re-render on a locale change: the context value
   * itself is new, so anything calling `t` during render gets the new
   * language. Only the effects stop firing a second time.
   */
  const t = useCallback((key: TranslationKey, vars?: Record<string, string | number>) => {
    const template = dictionaryRef.current[key] ?? en[key];
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) => String(vars[name] ?? match));
  }, []);

  // The API's English errors, said in this language from here on.
  useEffect(() => {
    setApiMessageTranslator((message) => translateApiMessage(message, (key) => dictionaryRef.current[key] ?? en[key]));
  }, []);

  const tn = useCallback(
    (baseKey: string, count: number, vars?: Record<string, string | number>) => {
      const form = new Intl.PluralRules(locale).select(count);
      // `_other` is the form every locale defines, so it is the fallback
      // when this one has no rule of its own for this category.
      const key = (`${baseKey}_${form}` in dictionaryRef.current ? `${baseKey}_${form}` : `${baseKey}_other`) as TranslationKey;
      return t(key, { count, ...vars });
    },
    [locale, t],
  );

  return <LocaleContext.Provider value={{ locale, setLocale, t, tn }}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}
