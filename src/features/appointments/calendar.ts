import type { ApplicationStatus, AppointmentStatus } from "@/lib/domain/constants";
import { addDaysIso, todayInIstanbul, weekdayOfIso } from "@/lib/validation/formats";

/**
 * MONTHLY CALENDAR
 * Grid of the months covering the given days. Weeks start on Monday; cells outside the month are empty (null).
 * Dates are "YYYY-MM-DD" strings; no time zone is involved.
 */

export type CalendarMonth = {
  /** "2026-11" */
  key: string;
  /** "Kasım 2026" */
  label: string;
  /** 7 cells per week: Monday … Sunday. */
  weeks: (string | null)[][];
};

export const WEEKDAY_SHORT_LABELS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"] as const;
export const WEEKDAY_LONG_LABELS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"] as const;

const MONTH_LABEL = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric", timeZone: "UTC" });

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number) as [number, number];
  const text = MONTH_LABEL.format(new Date(Date.UTC(y, m - 1, 1)));
  return text.charAt(0).toLocaleUpperCase("tr-TR") + text.slice(1);
}

/** Grid of one month ("2026-11"). */
export function monthGrid(key: string): CalendarMonth {
  const first = `${key}-01`;
  // Monday = 0 … Sunday = 6
  const offset = (weekdayOfIso(first) + 6) % 7;
  const cells: (string | null)[] = Array.from({ length: offset }, () => null);
  for (let date = first; date.startsWith(key); date = addDaysIso(date, 1)) cells.push(date);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return { key, label: monthLabel(key), weeks };
}

/** Months covering the days, oldest first (months without days in between are shown too). */
export function monthsCovering(dates: readonly string[]): CalendarMonth[] {
  if (dates.length === 0) return [];
  const sorted = [...dates].sort();
  const last = sorted.at(-1)!.slice(0, 7);
  const months: CalendarMonth[] = [];
  let [y, m] = sorted[0]!.slice(0, 7).split("-").map(Number) as [number, number];
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    months.push(monthGrid(key));
    if (key >= last) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

const LEAF_PARTS = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/**
 * Month name, day and time (Istanbul time) for the confirmed appointment's "calendar leaf": "Kasım", "27", "10:30".
 * null for an invalid timestamp.
 */
export function appointmentLeaf(iso: string): { month: string; day: string; time: string } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = LEAF_PARTS.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  const month = part("month");
  const day = part("day");
  const hour = part("hour");
  const minute = part("minute");
  return month && day && hour && minute ? { month, day, time: `${hour}:${minute}` } : null;
}

const PARTS = new Intl.DateTimeFormat("tr-TR", {
  timeZone: "Europe/Istanbul",
  day: "numeric",
  month: "long",
  year: "numeric",
  weekday: "long",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * Parts of the date for the appointment strip (Istanbul time): month "Ocak", day "1", year "2027", weekday "Cuma",
 * time "15:30", long date ", Cuma". null for an invalid timestamp.
 */
export function appointmentParts(iso: string): { month: string; day: string; year: string; weekday: string; time: string; longDate: string } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = PARTS.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const [month, day, year, weekday, hour, minute] = [part("month"), part("day"), part("year"), part("weekday"), part("hour"), part("minute")];
  if (!month || !day || !year || !hour) return null;
  return { month, day, year, weekday, time: `${hour}:${minute}`, longDate: `${day} ${month} ${year}, ${weekday}` };
}

/**
 * "Haritada aç" (open in maps) link: the Google Maps link the consultant entered for that location in Settings. Only an
 * address starting with "https://" and without spaces is used (the database applies the same rule); otherwise the button is hidden.
 */
export function appointmentMapsLink(url: string | null): string | null {
  const value = url?.trim() ?? "";
  return /^https:\/\/\S+$/.test(value) ? value : null;
}

/**
 * Should the appointment card on the customer's home page be shown? Only for a sent appointment whose day has not passed;
 * the card disappears once the appointment day (Istanbul time) has passed or the application is concluded or cancelled. Once the appointment time has passed the appointment is marked "took place" (migration 19; src/server/appointment-completion.ts).
 */
export function showUpcomingAppointment(
  input: { status: ApplicationStatus; appointmentStatus: AppointmentStatus; appointmentAt: string | null },
  now: Date,
): boolean {
  if (input.appointmentStatus !== "scheduled" || !input.appointmentAt) return false;
  if (input.status === "cancelled" || input.status === "result_communicated" || input.status === "awaiting_result") return false;
  const at = new Date(input.appointmentAt);
  if (Number.isNaN(at.getTime())) return false;
  return todayInIstanbul(at) >= todayInIstanbul(now);
}
