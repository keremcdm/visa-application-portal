import { CALENDAR_APPOINTMENT_SLOTS, type AppointmentSlot } from "@/lib/domain/constants";
import { addDaysIso, isValidIsoDate, weekdayOfIso } from "@/lib/validation/formats";

/**
 * APPOINTMENT PREFERENCE WINDOW
 *
 * This system does NOT book appointments in real time; the customer reports at least one and at most three preferences.
 * Preferences are picked from a calendar: each day once, as "Tüm gün" (all day), "Öğleden önce" (morning) or "Öğleden sonra" (afternoon).
 * The window is computed by number of selectable days (Europe/Istanbul): starting from today + startOffsetDays, the first
 * `windowDays` selectable days are offered. Weekends (if closed) and excluded dates are not counted; the window EXTENDS with
 * the following days instead: the default 10 days means 10 working days when weekends are closed. All values can be changed in Settings
 * (appointment.* keys).
 */

export type AppointmentConfig = {
  startOffsetDays: number;
  windowDays: number;
  includeWeekends: boolean;
  excludedDates: string[];
};

export const DEFAULT_APPOINTMENT_CONFIG: AppointmentConfig = {
  startOffsetDays: 1,
  windowDays: 10,
  includeWeekends: true,
  excludedDates: [],
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Builds a safe configuration from the raw values in the settings table. */
export function parseAppointmentConfig(settings: Readonly<Record<string, unknown>>): AppointmentConfig {
  const excluded = settings["appointment.excluded_dates"];
  return {
    startOffsetDays: clampInt(settings["appointment.start_offset_days"], 0, 30, DEFAULT_APPOINTMENT_CONFIG.startOffsetDays),
    windowDays: clampInt(settings["appointment.window_days"], 1, 60, DEFAULT_APPOINTMENT_CONFIG.windowDays),
    includeWeekends:
      typeof settings["appointment.include_weekends"] === "boolean"
        ? (settings["appointment.include_weekends"] as boolean)
        : DEFAULT_APPOINTMENT_CONFIG.includeWeekends,
    excludedDates: Array.isArray(excluded) ? excluded.filter((d): d is string => typeof d === "string" && isValidIsoDate(d)) : [],
  };
}

/** How many calendar days ahead the window can reach at most (stays finite even with a very long exclusion list). */
const MAX_WINDOW_SPAN_DAYS = 180;

export function selectableDates(today: string, config: AppointmentConfig): string[] {
  const excluded = new Set(config.excludedDates);
  const dates: string[] = [];
  for (let i = 0; dates.length < config.windowDays && i < MAX_WINDOW_SPAN_DAYS; i++) {
    const date = addDaysIso(today, config.startOffsetDays + i);
    const weekday = weekdayOfIso(date);
    if (!config.includeWeekends && (weekday === 0 || weekday === 6)) continue;
    if (excluded.has(date)) continue;
    dates.push(date);
  }
  return dates;
}

export type AppointmentPreference = { date: string; slot: AppointmentSlot };

/** Minimum and maximum number of days that can be picked for a normal preference. */
export const MIN_PREFERENCE_COUNT = 1;
export const MAX_PREFERENCE_COUNT = 3;

export type PreferenceValidation =
  | { ok: true; preferences: AppointmentPreference[] }
  | { ok: false; message: string };

function isSlot(value: unknown): value is AppointmentSlot {
  return typeof value === "string" && (CALENDAR_APPOINTMENT_SLOTS as readonly string[]).includes(value);
}

/** Validates the preference list: each item is a day and a time slot, days are within `allowed` and distinct. */
function checkDays(input: readonly unknown[], allowed: ReadonlySet<string>, outOfRange: string): PreferenceValidation {
  const seen = new Set<string>();
  const preferences: AppointmentPreference[] = [];
  for (const item of input) {
    const date = typeof item === "object" && item !== null ? (item as Record<string, unknown>).date : undefined;
    const slot = typeof item === "object" && item !== null ? (item as Record<string, unknown>).slot : undefined;
    if (typeof date !== "string" || !isValidIsoDate(date) || !isSlot(slot)) {
      return { ok: false, message: "Seçtiğiniz her gün için tüm gün, öğleden önce veya öğleden sonra seçiniz." };
    }
    if (!allowed.has(date)) return { ok: false, message: outOfRange };
    if (seen.has(date)) return { ok: false, message: "Aynı günü birden fazla kez seçemezsiniz." };
    seen.add(date);
    preferences.push({ date, slot });
  }
  return { ok: true, preferences };
}

/** Validates the preferences sent by the customer (untrusted data): 1–3 distinct days from the offered days. */
export function validatePreferences(input: unknown, today: string, config: AppointmentConfig): PreferenceValidation {
  if (!Array.isArray(input) || input.length < MIN_PREFERENCE_COUNT || input.length > MAX_PREFERENCE_COUNT) {
    return { ok: false, message: "Lütfen takvimden en az bir, en fazla üç gün seçiniz." };
  }
  return checkDays(
    input,
    new Set(selectableDates(today, config)),
    "Seçtiğiniz günlerden biri artık tercih edilebilir aralıkta değil. Lütfen tercihlerinizi güncelleyiniz.",
  );
}

/**
 * Converts previously saved preferences to a form the calendar can show: each day is picked once in the calendar;
 * if an old record has separate morning and afternoon preferences for the same day, that day counts as "Tüm gün".
 */
export function mergeSameDayPreferences(preferences: readonly AppointmentPreference[]): AppointmentPreference[] {
  const result: AppointmentPreference[] = [];
  for (const preference of preferences) {
    const existing = result.find((p) => p.date === preference.date);
    if (!existing) result.push({ ...preference });
    else if (existing.slot !== preference.slot) existing.slot = "full_day";
  }
  return result;
}

// ---------------------------------------------------------------------------
// "Bu tarihlerin hiçbiri bana uymuyor" (none of these dates suit me)
// ---------------------------------------------------------------------------
// The next 7 days and the following 10 working days are skipped; the working days after that, up to three months from
// today, are offered in the calendar. The customer picks at most three of them and says "Tüm gün", "Öğleden önce" or
// "Öğleden sonra" for each. Three preferences are not required. Working day: a weekday not excluded in Settings.

export const ALTERNATIVE_SKIP_CALENDAR_DAYS = 7;
export const ALTERNATIVE_SKIP_BUSINESS_DAYS = 10;
/** How far ahead the calendar reaches: number of months from today. */
export const ALTERNATIVE_HORIZON_MONTHS = 3;
export const MAX_ALTERNATIVE_PREFERENCES = 3;

/** "2026-11-30" + 3 months → "2027-02-28" (never past the end of the month). */
export function addMonthsIso(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

function isBusinessDay(date: string, excluded: ReadonlySet<string>): boolean {
  const weekday = weekdayOfIso(date);
  return weekday >= 1 && weekday <= 5 && !excluded.has(date);
}

/** Working days offered when "dates don't suit me" is chosen (Istanbul date). */
export function alternativeDates(today: string, config: AppointmentConfig): string[] {
  const excluded = new Set(config.excludedDates);
  let date = addDaysIso(today, ALTERNATIVE_SKIP_CALENDAR_DAYS);
  let skipped = 0;
  while (skipped < ALTERNATIVE_SKIP_BUSINESS_DAYS) {
    date = addDaysIso(date, 1);
    if (isBusinessDay(date, excluded)) skipped++;
  }
  const last = addMonthsIso(today, ALTERNATIVE_HORIZON_MONTHS);
  const dates: string[] = [];
  for (date = addDaysIso(date, 1); date <= last; date = addDaysIso(date, 1)) {
    if (isBusinessDay(date, excluded)) dates.push(date);
  }
  return dates;
}

/** Validates the "dates don't suit me" preferences (untrusted data): 1–3 distinct days from the offered working days. */
export function validateAlternativePreferences(input: unknown, today: string, config: AppointmentConfig): PreferenceValidation {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, message: "Size uygun en az bir gün seçiniz." };
  }
  if (input.length > MAX_ALTERNATIVE_PREFERENCES) {
    return { ok: false, message: "En fazla üç gün seçebilirsiniz." };
  }
  return checkDays(
    input,
    new Set(alternativeDates(today, config)),
    "Seçtiğiniz günlerden biri artık sunulan tarihler arasında değil. Lütfen seçiminizi güncelleyiniz.",
  );
}
