"use client";

import { useEffect, useState } from "react";
import { ageOn, isBirthdayOn, zodiacSign, ZODIAC_SYMBOLS, type CalendarDate } from "@platform/shared";
import { formatBirthday, formatMonthYear } from "@/lib/dates";
import { useLocale } from "./locale-provider";
import { CakeIcon, CalendarIcon, MapPinIcon } from "./icons";
import { CountryFlag } from "./country-flag";

export interface CreatorAbout {
  /** `year` is null when the author hides it — then there is no age either. */
  birthday: { year: number | null; month: number; day: number } | null;
  city: string | null;
  /** ISO 3166-1 alpha-2. */
  country: string | null;
  joinedAt: string;
}

/** "Россия", "Japan": the country in the reader's language, or its code if the browser cannot name it. */
export function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * The line of facts under an author's name, the way X draws it: where
 * they are, their birthday (with the sign and, if they show the year,
 * their age) and when they joined. On the day itself it says so.
 */
export function ProfileAbout({ about, variant = "line" }: { about: CreatorAbout | undefined; variant?: "line" | "table" }) {
  const { t, tn, locale } = useLocale();
  // The reader's own today, known only in the browser — set after the
  // first render so the server's page and the browser's agree.
  const [today, setToday] = useState<CalendarDate | null>(null);
  useEffect(() => {
    const now = new Date();
    setToday({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
  }, []);

  if (!about) return null;
  const { birthday } = about;
  const place = [about.city, about.country ? countryName(about.country, locale) : null].filter(Boolean).join(", ");
  const sign = birthday ? zodiacSign(birthday.month, birthday.day) : null;
  const age = birthday && birthday.year !== null && today ? ageOn({ ...birthday, year: birthday.year }, today) : null;

  const today_ = birthday && today && isBirthdayOn(birthday, today);

  // The VKontakte layout: the same facts as a table of labels and values.
  if (variant === "table") {
    return (
      <>
        {today_ && (
          <p className="profile-about-today">
            <span aria-hidden="true">🎉</span> {t("about.birthdayToday")}
          </p>
        )}
        <dl className="profile-about-table">
          {birthday && sign && (
            <>
              <dt>{t("about.birthDate")}:</dt>
              <dd>
                {formatBirthday(birthday, locale)}
                {age !== null && <>, {tn("about.age", age)}</>}
                {" · "}
                <span aria-hidden="true">{ZODIAC_SYMBOLS[sign]}</span> {t(`zodiac.${sign}`)}
              </dd>
            </>
          )}
          {about.city && (
            <>
              <dt>{t("about.city")}:</dt>
              <dd>{about.city}</dd>
            </>
          )}
          {about.country && (
            <>
              <dt>{t("about.country")}:</dt>
              <dd>
                {countryName(about.country, locale)} <CountryFlag code={about.country} />
              </dd>
            </>
          )}
          <dt>{t("about.joinedLabel")}:</dt>
          <dd>{formatMonthYear(about.joinedAt, locale)}</dd>
        </dl>
      </>
    );
  }

  return (
    <ul className="profile-about">
      {today_ && (
        <li className="profile-about-today">
          <span aria-hidden="true">🎉</span> {t("about.birthdayToday")}
        </li>
      )}
      {place && (
        <li>
          <MapPinIcon size={15} />
          <span>
            <span className="visually-hidden">{t("about.location")}: </span>
            {place}
            {about.country && <> <CountryFlag code={about.country} /></>}
          </span>
        </li>
      )}
      {birthday && sign && (
        <li>
          <CakeIcon size={15} />
          <span>
            {t("about.born", { date: formatBirthday(birthday, locale) })}
            {age !== null && <> · {tn("about.age", age)}</>}
            {" · "}
            <span className="profile-about-sign">
              <span aria-hidden="true">{ZODIAC_SYMBOLS[sign]}</span> {t(`zodiac.${sign}`)}
            </span>
          </span>
        </li>
      )}
      <li>
        <CalendarIcon size={15} />
        <span>{t("about.joined", { date: formatMonthYear(about.joinedAt, locale) })}</span>
      </li>
    </ul>
  );
}
