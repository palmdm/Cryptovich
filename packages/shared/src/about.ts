/**
 * An author's "about": the birthday (and what follows from it — the
 * zodiac sign, the age, the day subscribers are told), city and country.
 *
 * Pure functions on calendar dates, never on instants: a birthday is a
 * day of the year, and turning it into a moment would move it by a day
 * for half the world. Callers pass "today" as the date where they are.
 */

export interface CalendarDate {
  year: number;
  /** 1–12. */
  month: number;
  day: number;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

function compare(a: CalendarDate, b: CalendarDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

/** The earliest birth year accepted: nobody reading this was born before it. */
export const EARLIEST_BIRTH_YEAR = 1900;

/**
 * "1990-03-12" as a date that exists and is not after `today`, or null.
 * The format is the one an `<input type="date">` sends.
 */
export function parseBirthDate(value: string, today: CalendarDate): CalendarDate | null {
  const match = DATE_PATTERN.exec(value.trim());
  if (!match) return null;
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (date.year < EARLIEST_BIRTH_YEAR || date.month < 1 || date.month > 12) return null;
  if (date.day < 1 || date.day > daysInMonth(date.year, date.month)) return null;
  if (compare(date, today) > 0) return null;
  return date;
}

/** The calendar date of a moment in UTC — what a `DATE` column comes back as. */
export function utcCalendarDate(moment: Date): CalendarDate {
  return { year: moment.getUTCFullYear(), month: moment.getUTCMonth() + 1, day: moment.getUTCDate() };
}

/** Full years between `birth` and `today`. */
export function ageOn(birth: CalendarDate, today: CalendarDate): number {
  const hadBirthday = today.month > birth.month || (today.month === birth.month && today.day >= birth.day);
  return today.year - birth.year - (hadBirthday ? 0 : 1);
}

/**
 * Whether `today` is the birthday. Someone born on 29 February has it on
 * the 28th in a year without one — the day before it would have been.
 */
export function isBirthdayOn(birth: Pick<CalendarDate, "month" | "day">, today: CalendarDate): boolean {
  if (birth.month === 2 && birth.day === 29 && !isLeapYear(today.year)) return today.month === 2 && today.day === 28;
  return birth.month === today.month && birth.day === today.day;
}

export const ZODIAC_SIGNS = [
  "aries",
  "taurus",
  "gemini",
  "cancer",
  "leo",
  "virgo",
  "libra",
  "scorpio",
  "sagittarius",
  "capricorn",
  "aquarius",
  "pisces",
] as const;

export type ZodiacSign = (typeof ZODIAC_SIGNS)[number];

export const ZODIAC_SYMBOLS: Record<ZodiacSign, string> = {
  aries: "♈",
  taurus: "♉",
  gemini: "♊",
  cancer: "♋",
  leo: "♌",
  virgo: "♍",
  libra: "♎",
  scorpio: "♏",
  sagittarius: "♐",
  capricorn: "♑",
  aquarius: "♒",
  pisces: "♓",
};

/** The day each sign begins, in calendar order (the tropical zodiac). */
const SIGN_STARTS: readonly [month: number, day: number, sign: ZodiacSign][] = [
  [1, 20, "aquarius"],
  [2, 19, "pisces"],
  [3, 21, "aries"],
  [4, 20, "taurus"],
  [5, 21, "gemini"],
  [6, 21, "cancer"],
  [7, 23, "leo"],
  [8, 23, "virgo"],
  [9, 23, "libra"],
  [10, 23, "scorpio"],
  [11, 22, "sagittarius"],
  [12, 22, "capricorn"],
];

export function zodiacSign(month: number, day: number): ZodiacSign {
  // The last sign that has begun by this day; before 20 January that is
  // the Capricorn that began the previous December.
  let sign: ZodiacSign = "capricorn";
  for (const [m, d, s] of SIGN_STARTS) {
    if (month > m || (month === m && day >= d)) sign = s;
  }
  return sign;
}

/**
 * ISO 3166-1 alpha-2: every country and territory with a code. Kept as
 * codes, not names, so a page names it in its reader's language
 * (`Intl.DisplayNames`) and can draw its flag.
 */
export const COUNTRY_CODES = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ",
  "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS", "BT", "BV", "BW", "BY", "BZ",
  "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ",
  "DE", "DJ", "DK", "DM", "DO", "DZ",
  "EC", "EE", "EG", "EH", "ER", "ES", "ET",
  "FI", "FJ", "FK", "FM", "FO", "FR",
  "GA", "GB", "GD", "GE", "GF", "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY",
  "HK", "HM", "HN", "HR", "HT", "HU",
  "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT",
  "JE", "JM", "JO", "JP",
  "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ",
  "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY",
  "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK", "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ",
  "NA", "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ",
  "OM",
  "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY",
  "QA",
  "RE", "RO", "RS", "RU", "RW",
  "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SV", "SX", "SY", "SZ",
  "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ",
  "UA", "UG", "UM", "US", "UY", "UZ",
  "VA", "VC", "VE", "VG", "VI", "VN", "VU",
  "WF", "WS",
  "YE", "YT",
  "ZA", "ZM", "ZW",
] as const;

export type CountryCode = (typeof COUNTRY_CODES)[number];

const COUNTRY_SET: ReadonlySet<string> = new Set(COUNTRY_CODES);

export function isCountryCode(value: string): value is CountryCode {
  return COUNTRY_SET.has(value);
}

/** The flag: the code's two letters as regional-indicator symbols. */
export function countryFlag(code: string): string {
  if (!isCountryCode(code)) return "";
  return String.fromCodePoint(...[...code].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}
