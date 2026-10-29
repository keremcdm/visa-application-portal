/** Pure (side-effect free) helpers for date, phone, e-mail and money fields. */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH = /^(\d{4})-(\d{2})$/;

/** Is it a "YYYY-MM-DD" date that actually exists in the calendar? */
export function isValidIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

export function isValidIsoMonth(value: string): boolean {
  const m = ISO_MONTH.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return year >= 1900 && year <= 2100 && month >= 1 && month <= 12;
}

/** Returns the Istanbul date at the given moment as "YYYY-MM-DD". */
export function todayInIstanbul(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Adds days to an ISO date (via UTC; no time zone shift). */
export function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday */
export function weekdayOfIso(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "2026-03-07" -> "07.03.2026" */
export function formatDateTr(isoDate: string): string {
  const m = ISO_DATE.exec(isoDate);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : isoDate;
}

/**
 * Converts a date the user typed to "YYYY-MM-DD": "19.10.2026", "1.2.2026", "19/10/2026" or already
 * "2026-10-19". Returns null for a date that does not exist or is incomplete. (The server accepts both formats because the
 * date field can be submitted before the page is interactive.)
 */
export function parseDateInput(value: string): string | null {
  const text = value.trim();
  if (isValidIsoDate(text)) return text;
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(text);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return isValidIsoDate(iso) ? iso : null;
}

/** Puts the "GG.AA.YYYY" dots into the digits ("19102026" → "19.10.2026"). */
function maskDigits(digitsOnly: string): string {
  const digits = digitsOnly.slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
}

/**
 * Adds the dots automatically while typing: "19102026" → "19.10.2026"; a digit typed after the month reaches two digits
 * moves to the year. A space, dot, "/" or "-"
 * ends the day and month and zero-pads a single-digit day/month: "1 2 1995" → "01.02.1995".
 */
export function maskDateTyping(raw: string): string {
  const cleaned = raw
    .replace(/[\s/-]/g, ".")
    .replace(/[^\d.]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/^\./, "");
  const parts = cleaned.split(".");
  if (parts.length === 1 || parts[0]!.length > 2) return maskDigits(cleaned.replace(/\./g, ""));
  const pad = (value: string) => (value.length === 1 ? `0${value}` : value);
  const [day, month = "", ...rest] = parts;
  if (parts.length === 2) return month.length > 2 ? `${pad(day!)}.${month.slice(0, 2)}.${month.slice(2, 6)}` : `${pad(day!)}.${month}`;
  if (month.length > 2) return maskDigits(cleaned.replace(/\./g, ""));
  return `${pad(day!)}.${pad(month)}.${rest.join("").slice(0, 4)}`;
}

/**
 * Adds the colon automatically while typing a time: "0930" → "09:30", "9:5" stays as is. Only digits and ":"
 * are accepted.
 */
export function maskTimeTyping(raw: string): string {
  const cleaned = raw.replace(/[.,]/g, ":").replace(/[^\d:]/g, "").replace(/:{2,}/g, ":");
  if (cleaned.includes(":")) {
    const [hour = "", minute = ""] = cleaned.split(":");
    return `${hour.slice(0, 2)}:${minute.slice(0, 2)}`;
  }
  const digits = cleaned.slice(0, 4);
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

/** "9:30", "09:30" or "0930" → "09:30"; null if invalid (00:00–23:59). */
export function parseTimeInput(value: string): string | null {
  const m = /^(\d{1,2}):?(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${m[2]}`;
}

/** "tel:" link from a phone number: only digits and a leading "+" remain; null if there is no number. */
export function telHref(phone: string | null): string | null {
  const digits = (phone ?? "").trim().replace(/(?!^\+)[^\d]/g, "");
  return /^\+?\d{6,15}$/.test(digits) ? `tel:${digits}` : null;
}

/** "2026-03" -> "03.2026" */
export function formatMonthTr(isoMonth: string): string {
  const m = ISO_MONTH.exec(isoMonth);
  return m ? `${m[2]}.${m[1]}` : isoMonth;
}

const LONG_DATE = new Intl.DateTimeFormat("tr-TR", {
  timeZone: "UTC",
  day: "numeric",
  month: "long",
  year: "numeric",
  weekday: "long",
});

/** "2026-10-13" -> "Salı" */
export function formatDateLongTr(isoDate: string): string {
  if (!isValidIsoDate(isoDate)) return isoDate;
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return LONG_DATE.format(new Date(Date.UTC(y, m - 1, d)));
}

const DATE_TIME = new Intl.DateTimeFormat("tr-TR", {
  timeZone: "Europe/Istanbul",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Formats a timestamp as "13.10.2026 14:30" in Istanbul time. */
export function formatDateTimeTr(timestamp: string | Date): string {
  const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
  if (Number.isNaN(date.getTime())) return "";
  return DATE_TIME.format(date);
}

/** Reduces a phone number to digits (and a leading +). */
export function normalizePhone(value: string): string {
  const trimmed = value.trim();
  const digits = trimmed.replace(/[^0-9]/g, "");
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

/**
 * Turkish (0 5xx / +90 5xx) or international (with +, 8–15 digits) number.
 * A number written with +90 must be exactly 10 digits and must not start with 0 ("+90 0532 …" is invalid).
 */
export function isValidPhone(value: string): boolean {
  const n = normalizePhone(value);
  if (n.startsWith("+90")) return /^\+90[1-9][0-9]{9}$/.test(n);
  // 7–15 digits including the country code (E.164). In some small countries numbers are very short (e.g. Tokelau +690 7290).
  if (n.startsWith("+")) return /^\+[1-9][0-9]{6,14}$/.test(n);
  return /^0?[1-9][0-9]{9}$/.test(n);
}

export function isValidEmail(value: string): boolean {
  if (value.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

/**
 * Converts an amount the user typed ("45.000", "45 000,50", "45000") to a string with a decimal point.
 * Returns null if invalid.
 */
export function parseMoney(value: string): string | null {
  const cleaned = value.replace(/\s|₺|TL|tl/g, "");
  if (cleaned === "") return null;
  // Turkish notation: dot as the thousands separator, comma as the decimal separator.
  const tr = /^(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/.exec(cleaned);
  if (tr) {
    const [whole, frac] = cleaned.split(",") as [string, string | undefined];
    const normalized = whole.replace(/\./g, "").replace(/^0+(?=\d)/, "");
    return frac ? `${normalized}.${frac}` : normalized;
  }
  // Plain notation with a decimal point: 45000.50
  if (/^\d+\.\d{1,2}$/.test(cleaned)) return cleaned.replace(/^0+(?=\d)/, "");
  return null;
}

const MONEY_TR = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** "45000.5" -> "45.000,5" */
export function formatMoneyTr(normalized: string): string {
  const n = Number(normalized);
  return Number.isFinite(n) ? MONEY_TR.format(n) : normalized;
}

/** File size: "512 B", "214 KB", "1,4 MB". */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}
