import type { Locale } from "./i18n/dictionaries";

/**
 * Dates in the interface's language, not the browser's. Formatting with no
 * locale used the device's, so a Russian page on an English-language
 * phone read "25 Sept 2026" beside Russian text.
 */
export function formatDate(value: string | Date | null | undefined, locale: Locale): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(value: string | Date | null | undefined, locale: Locale): string {
  if (!value) return "";
  return new Date(value).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

/** "March 2024" / "март 2024 г." — when someone joined. */
export function formatMonthYear(value: string | Date | null | undefined, locale: Locale): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString(locale, { month: "long", year: "numeric" });
}

/**
 * A birthday: "12 March 1990", or "12 March" when the year is not shown.
 * A calendar day, not a moment — formatted in UTC so no time zone moves it,
 * with a leap year standing in for a missing one so 29 February exists.
 */
export function formatBirthday(birthday: { year: number | null; month: number; day: number }, locale: Locale): string {
  const date = new Date(Date.UTC(birthday.year ?? 2000, birthday.month - 1, birthday.day));
  return date.toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    ...(birthday.year !== null ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}
