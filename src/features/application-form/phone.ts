import { MAIN_COUNTRY_BY_DIAL_CODE, PHONE_COUNTRIES, type PhoneCountry } from "@/lib/domain/phone-codes";

/**
 * PHONE NUMBER: COUNTRY CODE + NUMBER
 * In the form a phone number is stored as a single string ("+90 532 123 45 67"). This file splits the string for the
 * country code picker and the number field and joins it back. Old numbers saved without a country code ("0532 …") are
 * treated as Turkish numbers and stay as they are until the customer changes them.
 */

/** Countries shown at the top of the list: Türkiye and the United Kingdom. */
const PINNED_ISO2 = ["TR", "GB"] as const;
export const DEFAULT_PHONE_COUNTRY = "TR";

const BY_ISO2 = new Map(PHONE_COUNTRIES.map((c) => [c.iso2, c]));

export function phoneCountry(iso2: string): PhoneCountry {
  return BY_ISO2.get(iso2) ?? BY_ISO2.get(DEFAULT_PHONE_COUNTRY)!;
}

export const PINNED_PHONE_COUNTRIES: readonly PhoneCountry[] = PINNED_ISO2.map(phoneCountry);
/** Countries other than those at the top, in Turkish alphabetical order. */
export const SORTED_PHONE_COUNTRIES: readonly PhoneCountry[] = PHONE_COUNTRIES.filter((c) => !(PINNED_ISO2 as readonly string[]).includes(c.iso2));

// International dialling codes cannot be prefixes of each other (E.164); the longest match is still tried first.
const DIAL_CODES = [...new Set(PHONE_COUNTRIES.map((c) => c.dialCode))].sort((a, b) => b.length - a.length);

export type ParsedPhone = {
  /** Country code in the string; null if there is none (empty or old record). */
  dialCode: string | null;
  /** Country to select for the code (the main country among those sharing it); Türkiye if there is no code. */
  iso2: string;
  /** Part shown in the number field. */
  national: string;
};

export function parsePhone(value: string): ParsedPhone {
  // Only leading whitespace is trimmed, so a trailing space the customer is typing is not lost.
  const text = value.replace(/^\s+/, "");
  if (text.startsWith("+")) {
    const compact = `+${text.replace(/[^0-9]/g, "")}`;
    const dialCode = DIAL_CODES.find((code) => compact.startsWith(code));
    if (dialCode) {
      const national = text.startsWith(dialCode) ? text.slice(dialCode.length).replace(/^\s+/, "") : compact.slice(dialCode.length);
      const iso2 = MAIN_COUNTRY_BY_DIAL_CODE[dialCode] ?? PHONE_COUNTRIES.find((c) => c.dialCode === dialCode)!.iso2;
      return { dialCode, iso2, national };
    }
    return { dialCode: null, iso2: DEFAULT_PHONE_COUNTRY, national: text };
  }
  // Old record: a Turkish number; the leading 0 is not shown in the number field.
  return { dialCode: null, iso2: DEFAULT_PHONE_COUNTRY, national: text.replace(/^0(?=[0-9])/, "") };
}

/** If the number is empty the value is empty too (so the required check works); otherwise "+90 532 …". */
export function composePhone(country: PhoneCountry, national: string): string {
  const number = national.replace(/^\s+/, "");
  return number.trim() === "" ? "" : `${country.dialCode} ${number}`;
}
