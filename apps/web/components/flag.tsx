"use client";

import { useId } from "react";
import type { Locale } from "@/lib/i18n/dictionaries";

/**
 * A language's flag, drawn rather than typed. Windows has no flag emoji
 * at all — Segoe UI Emoji leaves them out — and shows the two letters
 * ("RU", "GB") instead, and so do some Android builds. Cropped to a
 * circle by `.lang-flag`; `slice` keeps each flag's centre in it.
 */
export function Flag({ locale }: { locale: Locale }) {
  // The Union Jack's clip path needs an id unique to this copy: the
  // trigger and the open menu both draw it.
  const clip = `flag-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <span className="lang-flag" aria-hidden="true">
      {locale === "ru" ? (
        <svg viewBox="0 0 9 6" preserveAspectRatio="xMidYMid slice" focusable="false">
          <rect width="9" height="2" fill="#fff" />
          <rect y="2" width="9" height="2" fill="#0039a6" />
          <rect y="4" width="9" height="2" fill="#d52b1e" />
        </svg>
      ) : locale === "ja" ? (
        <svg viewBox="0 0 30 20" preserveAspectRatio="xMidYMid slice" focusable="false">
          <rect width="30" height="20" fill="#fff" />
          <circle cx="15" cy="10" r="6" fill="#bc002d" />
        </svg>
      ) : (
        <svg viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice" focusable="false">
          <clipPath id={clip}>
            <path d="M30,15h30v15zv15h-30zh-30v-15zv-15h30z" />
          </clipPath>
          <rect width="60" height="30" fill="#012169" />
          <path d="M0,0L60,30M60,0L0,30" stroke="#fff" strokeWidth="6" />
          <path d="M0,0L60,30M60,0L0,30" clipPath={`url(#${clip})`} stroke="#c8102e" strokeWidth="4" />
          <path d="M30,0v30M0,15h60" stroke="#fff" strokeWidth="10" />
          <path d="M30,0v30M0,15h60" stroke="#c8102e" strokeWidth="6" />
        </svg>
      )}
    </span>
  );
}
