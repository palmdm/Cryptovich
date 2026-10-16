"use client";

import { useLocale } from "@/components/locale-provider";
import { useTheme } from "@/components/theme-provider";
import { THEME_GROUPS, type Theme } from "@/lib/theme-script";
import { CheckIcon } from "@/components/icons";

function ThemeCard({
  option,
  selected,
  onSelect,
}: {
  option: Theme;
  selected: boolean;
  onSelect: (theme: Theme) => void;
}) {
  const { t } = useLocale();
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`theme-option${selected ? " selected" : ""}`}
      onClick={() => onSelect(option)}
    >
      {/* The swatch is the description: each one paints its own palette,
          so the light cards stay light while a dark theme is active. That
          is the one place tokens would be wrong. */}
      <span className={`theme-preview theme-preview-${option}`} aria-hidden="true">
        <span className="theme-preview-bar" />
        <span className="theme-preview-line" />
        <span className="theme-preview-line short" />
      </span>
      <span className="theme-option-head">
        <strong>{t(`theme.${option}`)}</strong>
        {selected && <CheckIcon size={16} />}
      </span>
      <span className="meta">{t(`theme.${option}Hint`)}</span>
    </button>
  );
}

/**
 * A display preference, not an account setting — it is stored in the
 * browser, so it needs no session and works signed out.
 */
export default function AppearanceSettingsPage() {
  const { t } = useLocale();
  const { theme, setTheme, ready } = useTheme();
  const isSelected = (option: Theme) => ready && theme === option;

  return (
    <div className="stack">
      <h1>{t("theme.title")}</h1>
      <p className="lede">{t("theme.lede")}</p>

      <div className="card stack">
        <h2 style={{ margin: 0 }}>{t("theme.label")}</h2>

        <div className="theme-options" role="radiogroup" aria-label={t("theme.label")}>
          <ThemeCard option="system" selected={isSelected("system")} onSelect={setTheme} />
        </div>

        {THEME_GROUPS.map((group) => (
          <div key={group.labelKey} className="theme-group">
            <h3 className="theme-group-heading">{t(group.labelKey)}</h3>
            <div className="theme-options" role="radiogroup" aria-label={t(group.labelKey)}>
              {group.themes.map((option) => (
                <ThemeCard key={option} option={option} selected={isSelected(option)} onSelect={setTheme} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
