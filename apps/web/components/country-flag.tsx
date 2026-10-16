import { isCountryCode } from "@platform/shared";

/**
 * A country's flag as a picture (public/flags, from country-flag-icons,
 * MIT). Flag emoji are not an option: Windows draws them as two letters.
 */
export function CountryFlag({ code }: { code: string }) {
  if (!isCountryCode(code)) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="country-flag" src={`/flags/${code.toLowerCase()}.svg`} alt="" aria-hidden="true" width={18} height={12} decoding="async" />
  );
}
