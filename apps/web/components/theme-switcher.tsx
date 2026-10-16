"use client";

import { useState, useRef, useEffect } from "react";
import { useLocale } from "./locale-provider";
import { useTheme } from "./theme-provider";
import { THEME_GROUPS, THEME_SWATCHES, type Theme } from "@/lib/theme-script";
import { MonitorIcon } from "./icons";

/**
 * A theme as one circle, split along the diagonal: the ground on one
 * side, the accent on the other.
 *
 * It replaces a menu of translated names. Those names are what broke the
 * header — "Тёмная с пониженной яркостью" is four times the width of
 * "Dimmed" — and with a dozen themes no wording would have fitted. A
 * swatch is the same size in every language, and shows the theme itself
 * rather than describing it. The name stays as the accessible label and
 * the tooltip, so nothing is lost for a screen reader.
 */
function Swatch({ theme }: { theme: Theme }) {
  if (theme === "system") {
    return (
      <span className="theme-dot theme-dot-system" aria-hidden="true">
        <MonitorIcon size={15} />
      </span>
    );
  }
  const [ground, accent] = THEME_SWATCHES[theme];
  return (
    <span
      className="theme-dot"
      aria-hidden="true"
      style={{ background: `linear-gradient(135deg, ${ground} 0 50%, ${accent} 50% 100%)` }}
    />
  );
}

export function ThemeSwitcher() {
  const { t } = useLocale();
  const { theme, setTheme, ready } = useTheme();
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

  // Showing the stored theme's swatch before the choice has been read
  // would paint one theme's colours and then swap them.
  const current = ready ? theme : "system";

  function choose(option: Theme) {
    setTheme(option);
    setOpen(false);
  }

  function option(value: Theme) {
    const label = t(`theme.${value}`);
    return (
      <button
        key={value}
        type="button"
        role="menuitemradio"
        aria-checked={value === theme}
        aria-label={label}
        title={label}
        className={`theme-dot-button${value === theme ? " selected" : ""}`}
        onClick={() => choose(value)}
      >
        <Swatch theme={value} />
      </button>
    );
  }

  return (
    <div className="lang" ref={ref}>
      <button
        type="button"
        className="lang-trigger"
        aria-label={t("theme.label")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Swatch theme={current} />
      </button>

      {open && (
        // One line a group — its name, then its swatches — so the menu is
        // a short table rather than a tall column of headings and gaps.
        <div className="lang-menu theme-menu" role="menu" aria-label={t("theme.label")}>
          <div className="theme-menu-row">
            <span className="theme-menu-label">{t("theme.system")}</span>
            <div className="theme-dot-row">{option("system")}</div>
          </div>
          {THEME_GROUPS.map((group) => (
            <div key={group.labelKey} className="theme-menu-row">
              <span className="theme-menu-label">{t(group.labelKey)}</span>
              <div className="theme-dot-row">{group.themes.map(option)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
