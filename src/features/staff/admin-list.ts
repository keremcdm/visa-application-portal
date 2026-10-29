import type { AppointmentStatus, PaymentStatus } from "@/lib/domain/constants";
import type { AdminStateKey, AdminTone } from "./admin-state";

/**
 * Payment / Documents / Appointment cells in the Applications list.
 * Labels are short because the column heading already says what they are ("Doğrulandı", "Kontrol ediliyor"); the second
 * line is only written if it carries information (a number, a date). If the stage has not been reached yet, that is stated
 * clearly too ("Gönderilmedi", "İncelenmedi", "Tercih yok"); "—" is not used.
 * Numbers come from real data.
 */
export type ListCell = { label: string; tone: AdminTone; sub: string };

export type ListRowFacts = {
  key: AdminStateKey;
  paymentStatus: PaymentStatus;
  /** Number of uploaded receipts. */
  receipts: number;
  /** Required (in-scope) documents: total, marked "Uygun", awaited from the customer. */
  documents: { total: number; approved: number; outstanding: number };
  appointmentStatus: AppointmentStatus;
  appointmentAt: string | null;
  preferenceCount: number;
};

const BEFORE_PAYMENT: readonly AdminStateKey[] = ["draft", "awaitingPayment", "a", "payRejected"];

const NOT_SUBMITTED: ListCell = { label: "Gönderilmedi", tone: "gray", sub: "" };
const CANCELLED: ListCell = { label: "İptal edildi", tone: "gray", sub: "" };

export function paymentCell(f: ListRowFacts): ListCell {
  switch (f.key) {
    case "draft":
      return NOT_SUBMITTED;
    case "awaitingPayment":
      return { label: "Bekleniyor", tone: "yellow", sub: f.receipts > 0 ? "Dekont yüklendi" : "" };
    case "a":
      return { label: "Kontrol ediliyor", tone: "navy", sub: f.receipts > 0 ? "Dekont yüklendi" : "" };
    case "payRejected":
      return { label: "Reddedildi", tone: "red", sub: "" };
    default:
      return f.paymentStatus === "verified" ? { label: "Doğrulandı", tone: "green", sub: "" } : { label: "Doğrulanmadı", tone: "gray", sub: "" };
  }
}

export function documentsCell(f: ListRowFacts): ListCell {
  if (f.key === "draft") return NOT_SUBMITTED;
  if (f.key === "h") return CANCELLED;
  // Documents are reviewed after the payment is verified.
  if (BEFORE_PAYMENT.includes(f.key)) return { label: "İncelenmedi", tone: "gray", sub: "Ödemeden sonra" };
  if (f.documents.outstanding > 0) return { label: `${f.documents.outstanding} eksik`, tone: "yellow", sub: "" };
  if (f.key === "b" || f.key === "c") return { label: "İnceleniyor", tone: "navy", sub: `${f.documents.approved} / ${f.documents.total} onaylı` };
  return { label: "Onaylandı", tone: "green", sub: `${f.documents.total} belge` };
}

const SHORT_DATE = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "short", year: "numeric" });
const SHORT_TIME = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "19 Kas 2026 · 09:30" (Istanbul time). */
export function shortDateTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : `${SHORT_DATE.format(date)} · ${SHORT_TIME.format(date)}`;
}

export function appointmentCell(f: ListRowFacts): ListCell {
  if (f.key === "h") return CANCELLED;
  // A date is only shown for a sent or completed appointment.
  if (f.appointmentStatus === "completed") return { label: "Gerçekleşti", tone: "green", sub: shortDateTime(f.appointmentAt) };
  if (f.appointmentStatus === "scheduled") return { label: "Bildirildi", tone: "green", sub: shortDateTime(f.appointmentAt) };
  if (f.appointmentStatus === "preferences_requested") return { label: "Tercih bekleniyor", tone: "yellow", sub: "" };
  if (f.key === "d") return { label: "Bildirilecek", tone: "navy", sub: f.preferenceCount > 0 ? `${f.preferenceCount} tercih` : "Tercih yok" };
  return f.preferenceCount > 0 ? { label: "Tercih alındı", tone: "gray", sub: "" } : { label: "Tercih yok", tone: "gray", sub: "" };
}

/** Closed applications (concluded or cancelled) leave the list after this many days; visible with "Tamamlananları göster". */
export const CLOSED_VISIBLE_DAYS = 7;

/** Is the application closed with more than CLOSED_VISIBLE_DAYS days since the last action? */
export function isArchived(key: AdminStateKey, updatedAt: string, now: Date): boolean {
  if (key !== "g" && key !== "h") return false;
  const then = new Date(updatedAt);
  return !Number.isNaN(then.getTime()) && now.getTime() - then.getTime() > CLOSED_VISIBLE_DAYS * 86_400_000;
}
