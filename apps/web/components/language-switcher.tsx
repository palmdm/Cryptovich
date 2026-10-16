"use client";

import { useState, useRef, useEffect } from "react";
import { useLocale } from "./locale-provider";
import { LOCALES, LOCALE_META, type Locale } from "@/lib/i18n/dictionaries";
import { Flag } from "./flag";

/**
 * A flag button that opens the three languages by flag and native name.
 * The flag alone never carries the meaning — a reader who does not
 * recognise it still gets "Русский" next to it.
 */
export function LanguageSwitcher() {
  const { locale, setLocale, t } = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function choose(next: Locale) {
    setLocale(next);
    setOpen(false);
  }

  return (
    <div className="lang" ref={ref}>
      <button
        type="button"
        className="lang-trigger"
        aria-label={t("nav.language")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Flag locale={locale} />
      </button>

      {open && (
        <div className="lang-menu" role="menu">
          {LOCALES.map((code) => (
            <button
              key={code}
              type="button"
              role="menuitemradio"
              aria-checked={code === locale}
              className={`lang-option${code === locale ? " selected" : ""}`}
              onClick={() => choose(code)}
            >
              <Flag locale={code} />
              {LOCALE_META[code].name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
