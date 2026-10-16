"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { RETIRED_THEMES, THEME_STORAGE_KEY, THEMES, type Theme } from "@/lib/theme-script";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** False until the stored choice has been read, so nothing renders a wrong selection first. */
  ready: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  setTheme: () => {},
  ready: false,
});

function isTheme(value: string | null): value is Theme {
  return value !== null && (THEMES as readonly string[]).includes(value);
}

/**
 * "system" is the default and needs no JavaScript at all — the stylesheet
 * resolves it through `prefers-color-scheme`, and this provider simply
 * removes the `data-theme` attribute so that query is what applies. An
 * explicit choice writes the attribute, which every dark rule is also
 * keyed on, so the override wins in both directions.
 *
 * The same attribute is set before first paint by the inline script in
 * the root layout; this only keeps it in sync afterwards.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      // Storage refused: the default it is.
    }
    // The inline script has normally rewritten a retired choice already.
    if (stored && RETIRED_THEMES[stored]) stored = RETIRED_THEMES[stored]!;
    if (isTheme(stored)) setThemeState(stored);
    setReady(true);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private-browsing modes reject writes; the choice still applies
      // for this page, it just will not be remembered.
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTheme, ready }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
