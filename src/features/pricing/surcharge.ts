import { CURRENCY_LABELS, type Currency } from "@/lib/domain/constants";
import { formatMoneyTr } from "@/lib/validation/formats";

/**
 * The appointment city's surcharge is shown to the customer like this: "1.250 TL". null if there is no surcharge.
 * The company enters the amount on Settings → Appointment cities.
 */
export function surchargeText(amount: number, currency: Currency): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return `${formatMoneyTr(String(amount))} ${CURRENCY_LABELS[currency]}`;
}

/** Name shown in the city list: "Ankara (+1.250 TL ek ücret)". */
export function cityOptionLabel(name: string, amount: number, currency: Currency): string {
  const surcharge = surchargeText(amount, currency);
  return surcharge ? `${name} (+${surcharge} ek ücret)` : name;
}
