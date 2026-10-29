import type { ApplicationStatus, AppointmentStatus, PaymentStatus } from "@/lib/domain/constants";

/**
 * ADMIN PANEL — STATUS VIEW
 *
 * The status keys in the design (draft, a, payRejected, b, c, d, d2, f, g, h) are derived from the app's real statuses.
 * The only state not in the design is "awaitingPayment": the customer has not paid and reported it yet (the customer's turn).
 * Turn (who it is waiting on), the stage bar, label tones and "Sıradaki iş" texts are here; screens only draw them.
 */

export type AdminTone = "navy" | "solid" | "yellow" | "green" | "red" | "gray";
export type AdminOwner = "us" | "customer" | "auto" | "closed";
export type AdminStateKey = "draft" | "awaitingPayment" | "a" | "payRejected" | "b" | "c" | "d" | "d2" | "f" | "g" | "h";

export type AdminStateInput = {
  status: ApplicationStatus;
  paymentStatus: PaymentStatus;
  appointmentStatus: AppointmentStatus;
};

export function adminStateKey(input: AdminStateInput): AdminStateKey {
  switch (input.status) {
    case "draft":
      return "draft";
    case "submitted":
      if (input.paymentStatus === "rejected") return "payRejected";
      if (input.paymentStatus === "under_review" || input.paymentStatus === "verified") return "a";
      return "awaitingPayment";
    case "in_review":
      return "b";
    case "awaiting_customer":
      return "c";
    case "documents_complete":
      return input.appointmentStatus === "scheduled" ? "d2" : "d";
    case "awaiting_result":
      return "f";
    case "result_communicated":
      return "g";
    case "cancelled":
      return "h";
  }
}

type StateInfo = {
  /** Overall status label. */
  pill: [string, AdminTone];
  owner: AdminOwner;
  /** Current stage in the stage bar (0–5). */
  stage: number;
};

export const ADMIN_STATES: Record<AdminStateKey, StateInfo> = {
  draft: { pill: ["Taslak", "gray"], owner: "customer", stage: 0 },
  awaitingPayment: { pill: ["Ödeme bekleniyor", "yellow"], owner: "customer", stage: 0 },
  a: { pill: ["Ödeme kontrol ediliyor", "navy"], owner: "us", stage: 0 },
  payRejected: { pill: ["Ödeme reddedildi", "red"], owner: "customer", stage: 0 },
  b: { pill: ["İnceleme aşamasında", "navy"], owner: "us", stage: 1 },
  c: { pill: ["Müşteriden işlem bekleniyor", "yellow"], owner: "customer", stage: 2 },
  d: { pill: ["Evraklar tamamlandı", "navy"], owner: "us", stage: 3 },
  d2: { pill: ["Randevu bildirildi", "navy"], owner: "auto", stage: 3 },
  f: { pill: ["Sonuç bekleniyor", "navy"], owner: "us", stage: 4 },
  g: { pill: ["Sonuçlandı", "green"], owner: "closed", stage: 5 },
  h: { pill: ["İptal edildi", "red"], owner: "closed", stage: 1 },
};

/** Stage names on the list screen (the bar's segments and "2/6 · İnceleme"). */
export const LIST_STAGE_NAMES = ["Ödeme kontrolü", "İnceleme", "Ek evrak", "Randevu", "Sonuç bekleniyor", "Sonuçlandı"] as const;

/** Names of the 6-step stage line on the detail screen. */
export const DETAIL_STAGE_NAMES = ["Başvuru alındı / ödeme kontrolü", "İnceleme", "Ek evrak / müşteriden işlem", "Randevu", "Sonuç bekleniyor", "Sonuçlandı"] as const;

// --- Turn ----------------------------------------------------------------------------------------------------

export type TurnInfo = { label: string; kind: "us" | "customer" | "auto" | "done" | "cancel" };

export function turnOf(key: AdminStateKey): TurnInfo {
  const owner = ADMIN_STATES[key].owner;
  if (owner === "us") return { label: "Sıra bizde", kind: "us" };
  if (owner === "customer") return { label: "Sıra müşteride", kind: "customer" };
  if (owner === "auto") return { label: "Otomatik bekliyor", kind: "auto" };
  return key === "h" ? { label: "İptal edildi", kind: "cancel" } : { label: "Tamamlandı", kind: "done" };
}

/** Owner label on the "Sıradaki iş" card. */
export const OWNER_LABELS: Record<AdminOwner, [string, AdminTone]> = {
  us: ["Bizde", "solid"],
  customer: ["Müşteride", "yellow"],
  auto: ["Bekleniyor (otomatik)", "gray"],
  closed: ["Kapandı", "gray"],
};

/** List tabs: Tümü, Bizde bekleyen, Müşteride, Randevu günü bekleniyor, Kapanan (all, waiting on us, with customer, awaiting appointment day, closed). */
export const LIST_TABS = [
  { id: "all", label: "Tümü", owner: null },
  { id: "ours", label: "Bizde bekleyen", owner: "us" },
  { id: "customer", label: "Müşteride", owner: "customer" },
  { id: "appointment", label: "Randevu günü bekleniyor", owner: "auto" },
  { id: "closed", label: "Kapanan", owner: "closed" },
] as const satisfies readonly { id: string; label: string; owner: AdminOwner | null }[];
export type ListTabId = (typeof LIST_TABS)[number]["id"];

// --- Stage bar (list) ---------------------------------------------------------------------------------------

/** D done · S skipped · x current (on us) · c current (with customer) · W waiting · X cancelled. */
export type SegmentCode = "D" | "S" | "x" | "c" | "W" | "X";

/**
 * The 6-segment stage bar on a list row. `extraRequested`: was the extra documents stage opened ("skipped" if not).
 * When cancelled, the stage where it was cancelled becomes `X` (the design shows the review stage as the example).
 */
export function listSegments(key: AdminStateKey, extraRequested: boolean, cancelledStage = 1): SegmentCode[] {
  const extra: SegmentCode = extraRequested ? "D" : "S";
  const owner = ADMIN_STATES[key].owner;
  const current: SegmentCode = owner === "customer" ? "c" : "x";
  switch (key) {
    case "draft":
    case "awaitingPayment":
    case "payRejected":
    case "a":
      return [current, "W", "W", "W", "W", "W"];
    case "b":
      return ["D", "x", "W", "W", "W", "W"];
    case "c":
      // Review done and missing items requested: the review segment is done, the extra documents segment is with the customer.
      return ["D", "D", "c", "W", "W", "W"];
    case "d":
    case "d2":
      return ["D", "D", extra, "x", "W", "W"];
    case "f":
      return ["D", "D", extra, "D", "x", "W"];
    case "g":
      return ["D", "D", extra, "D", "D", "D"];
    case "h": {
      const stage = Math.min(Math.max(cancelledStage, 0), 5);
      return Array.from({ length: 6 }, (_, i): SegmentCode => (i < stage ? (i === 2 ? extra : "D") : i === stage ? "X" : "W"));
    }
  }
}

/** At which stage the cancelled application was cancelled (from the status before cancellation). */
export function stageOfStatus(status: string | null): number {
  switch (status) {
    case "in_review":
      return 1;
    case "awaiting_customer":
    case "correction_required":
      return 2;
    case "documents_complete":
      return 3;
    case "awaiting_result":
    case "visa_submitted":
      return 4;
    default:
      return 0;
  }
}

// --- Section modes (detail, "MODES") -------------------------------------------------------------------------

export type SectionMode = "open" | "done" | "locked" | "row" | "current";
export type SectionModes = { pay: SectionMode; review: SectionMode; tasks: SectionMode; appt: SectionMode; visa: SectionMode };

export const SECTION_MODES: Record<AdminStateKey, SectionModes> = {
  draft: { pay: "locked", review: "locked", tasks: "row", appt: "locked", visa: "locked" },
  awaitingPayment: { pay: "open", review: "locked", tasks: "row", appt: "locked", visa: "locked" },
  a: { pay: "open", review: "locked", tasks: "row", appt: "locked", visa: "locked" },
  payRejected: { pay: "open", review: "locked", tasks: "row", appt: "locked", visa: "locked" },
  b: { pay: "done", review: "open", tasks: "open", appt: "locked", visa: "locked" },
  c: { pay: "done", review: "open", tasks: "open", appt: "locked", visa: "locked" },
  d: { pay: "done", review: "done", tasks: "row", appt: "open", visa: "locked" },
  d2: { pay: "done", review: "done", tasks: "row", appt: "open", visa: "locked" },
  f: { pay: "done", review: "done", tasks: "row", appt: "done", visa: "current" },
  g: { pay: "done", review: "done", tasks: "row", appt: "done", visa: "open" },
  h: { pay: "done", review: "locked", tasks: "row", appt: "locked", visa: "locked" },
};

// --- Time ---------------------------------------------------------------------------------

/** "Az önce", "N saat önce", "Dün", "N gün önce". */
export function relativeTime(iso: string, now: Date): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const hours = (now.getTime() - then.getTime()) / 3_600_000;
  if (hours < 1) return "Az önce";
  if (hours < 24) return `${Math.floor(hours)} saat önce`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Dün" : `${days} gün önce`;
}

/** Waiting time (whole days): only shown when it is our or the customer's turn and at least one day. */
export function waitingDays(iso: string, now: Date): number {
  const then = new Date(iso);
  return Number.isNaN(then.getTime()) ? 0 : Math.max(0, Math.floor((now.getTime() - then.getTime()) / 86_400_000));
}
