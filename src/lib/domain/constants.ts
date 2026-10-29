/**
 * Domain constants: application types, statuses and their Turkish labels.
 * They hold the same values as the CHECK constraints in the database (supabase/migrations);
 * the tests under tests/db verify this match.
 */

// --- Application types ------------------------------------------------------

export const APPLICATION_TYPES = [
  "general_employee",
  "self_employed",
  "retired",
  "student",
  "uk_family_visit",
  "sponsored",
] as const;
export type ApplicationType = (typeof APPLICATION_TYPES)[number];

export const APPLICATION_TYPE_LABELS: Record<ApplicationType, string> = {
  general_employee: "Genel (Çalışan)",
  self_employed: "Self Employed (Kendi İşinin Sahibi)",
  retired: "Emekli",
  student: "Öğrenci",
  uk_family_visit: "İngiltere Akraba Ziyareti",
  sponsored: "Sponsorlu Başvuru",
};

export const APPLICATION_TYPE_DESCRIPTIONS: Record<ApplicationType, string> = {
  general_employee: "Bir işyerinde ücretli olarak çalışıyorsanız.",
  self_employed: "Kendi şirketinizin veya işyerinizin sahibiyseniz.",
  retired: "Emekliyseniz.",
  student: "Öğrenciyseniz.",
  uk_family_visit: "İngiltere'de yaşayan bir akrabanızın daveti ile gidecekseniz.",
  sponsored: "Seyahat masraflarınızı bir sponsor karşılayacaksa.",
};

export function isApplicationType(value: unknown): value is ApplicationType {
  return typeof value === "string" && (APPLICATION_TYPES as readonly string[]).includes(value);
}

/**
 * Display order in select lists: Turkish alphabetical by label.
 * Status lists that carry a process order (application, payment and appointment status) are exempt from this rule.
 * The order is given by hand (so it is identical on server and browser); tests/rules/business-rules.test.ts verifies it.
 */
export const APPLICATION_TYPES_BY_LABEL: readonly ApplicationType[] = [
  "retired",
  "general_employee",
  "uk_family_visit",
  "student",
  "self_employed",
  "sponsored",
];

export const SPONSOR_STATUSES = ["employee", "retired", "business_owner"] as const;
export type SponsorStatus = (typeof SPONSOR_STATUSES)[number];

export const SPONSOR_STATUS_LABELS: Record<SponsorStatus, string> = {
  employee: "Çalışan",
  retired: "Emekli",
  business_owner: "İşyeri sahibi",
};

export function isSponsorStatus(value: unknown): value is SponsorStatus {
  return typeof value === "string" && (SPONSOR_STATUSES as readonly string[]).includes(value);
}

// --- Overall application status ---------------------------------------------
// The status follows automatically from what has been done: the rule is in
// src/features/applications/status-flow.ts, in the database private.next_application_status (migration 12).

export const APPLICATION_STATUSES = [
  "draft",
  "submitted",
  "in_review",
  "awaiting_customer",
  "documents_complete",
  "awaiting_result",
  "result_communicated",
  "cancelled",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  draft: "Taslak",
  submitted: "Başvuru gönderildi",
  in_review: "İnceleme aşamasında",
  awaiting_customer: "Müşteriden işlem bekleniyor",
  documents_complete: "Evraklar tamamlandı",
  awaiting_result: "Sonuç bekleniyor",
  result_communicated: "Sonuç müşteriye bildirildi",
  cancelled: "İptal edildi",
};

/**
 * Statuses removed with database migration 12. Old transitions in the audit log are shown with these names;
 * values read before the migration was run are mapped to their new counterparts.
 */
export const LEGACY_APPLICATION_STATUSES: Record<string, { label: string; current: ApplicationStatus }> = {
  correction_required: { label: "Evrak eksik veya düzeltme gerekli", current: "awaiting_customer" },
  visa_submitted: { label: "Vize başvurusu yapıldı", current: "awaiting_result" },
};

/** Short explanations shown to the customer. They stress that the consulate makes the visa decision. */
export const APPLICATION_STATUS_CUSTOMER_HINTS: Record<ApplicationStatus, string> = {
  draft: "Başvurunuzu henüz göndermediniz. Kaldığınız yerden devam edebilirsiniz.",
  submitted: "Başvurunuz bize ulaştı. Ödemeniz doğrulandıktan sonra inceleme başlayacaktır.",
  in_review: "Danışmanlarımız bilgi ve belgelerinizi inceliyor.",
  awaiting_customer: "Sizden bir belge, düzeltme veya işlem bekliyoruz. Aşağıdaki işlemleri tamamlayınız.",
  documents_complete: "Evraklarınız tamamlandı.",
  awaiting_result: "Vize kararı yetkili makam tarafından verilir; sonuç bekleniyor.",
  result_communicated: "Yetkili makamın verdiği sonuç tarafınıza bildirildi.",
  cancelled: "Bu başvuru iptal edildi.",
};

/** Statuses that cannot be reached without a verified payment (a database trigger applies the same rule). */
export const STATUSES_REQUIRING_VERIFIED_PAYMENT: readonly ApplicationStatus[] = [
  "in_review",
  "awaiting_customer",
  "documents_complete",
  "awaiting_result",
  "result_communicated",
];

export function isApplicationStatus(value: unknown): value is ApplicationStatus {
  return typeof value === "string" && (APPLICATION_STATUSES as readonly string[]).includes(value);
}

/** Status read from the database; old values from before migration 12 are mapped to their new counterparts. */
export function toApplicationStatus(value: unknown): ApplicationStatus | null {
  if (isApplicationStatus(value)) return value;
  return typeof value === "string" ? (LEGACY_APPLICATION_STATUSES[value]?.current ?? null) : null;
}

/** Name of a (possibly old) status in the audit log. */
export function applicationStatusLabel(value: unknown): string {
  if (isApplicationStatus(value)) return APPLICATION_STATUS_LABELS[value];
  return typeof value === "string" ? (LEGACY_APPLICATION_STATUSES[value]?.label ?? value) : "";
}

// --- Visa outcome -----------------------------------------------------------
// The competent authority makes the decision; staff only pass it on.

export const VISA_OUTCOMES = ["approved", "refused"] as const;
export type VisaOutcome = (typeof VISA_OUTCOMES)[number];

/** Title shown to the customer. */
export const VISA_OUTCOME_LABELS: Record<VisaOutcome, string> = {
  approved: "Vize başvurunuz onaylandı",
  refused: "Vize başvurunuz reddedildi",
};

/**
 * Application statuses in which the visa outcome can be recorded (the database function applies the same rule). "Evraklar
 * tamamlandı" is included so the outcome can be recorded even if the appointment is not in the system.
 */
export const VISA_OUTCOME_STATUSES: readonly ApplicationStatus[] = ["documents_complete", "awaiting_result", "result_communicated"];

export const VISA_OUTCOME_NOTE_MAX = 2000;

export function isVisaOutcome(value: unknown): value is VisaOutcome {
  return typeof value === "string" && (VISA_OUTCOMES as readonly string[]).includes(value);
}

// --- Payment status ---------------------------------------------------------

export const PAYMENT_STATUSES = ["not_due", "awaiting_payment", "under_review", "verified", "rejected"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  not_due: "Henüz ödeme aşamasında değil",
  awaiting_payment: "Ödeme bekleniyor",
  under_review: "Ödeme kontrol ediliyor",
  verified: "Ödeme doğrulandı",
  rejected: "Ödeme doğrulanamadı",
};

export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return typeof value === "string" && (PAYMENT_STATUSES as readonly string[]).includes(value);
}

// --- Appointment status -----------------------------------------------------
// The consultant does not pick a status; the "Randevu tarihini bildir" (send appointment date) and "Yeni tercih iste"
// (request new preferences) buttons set it, and once the date has passed a scheduled job sets "Randevu gerçekleşti".

export const APPOINTMENT_STATUSES = ["not_started", "preferences_submitted", "preferences_requested", "scheduled", "completed"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  not_started: "Randevu tercihi bildirilmedi",
  preferences_submitted: "Randevu tercihleri alındı",
  preferences_requested: "Yeni randevu tercihi bekleniyor",
  scheduled: "Randevu tarihi bildirildi",
  completed: "Randevu gerçekleşti",
};

/** Appointment status removed with database migration 12 (shown with its old name in the audit log). */
export const LEGACY_APPOINTMENT_STATUSES: Record<string, { label: string; current: AppointmentStatus }> = {
  booking_in_progress: { label: "Randevu ayarlanıyor", current: "preferences_submitted" },
};

export function isAppointmentStatus(value: unknown): value is AppointmentStatus {
  return typeof value === "string" && (APPOINTMENT_STATUSES as readonly string[]).includes(value);
}

export function toAppointmentStatus(value: unknown): AppointmentStatus | null {
  if (isAppointmentStatus(value)) return value;
  return typeof value === "string" ? (LEGACY_APPOINTMENT_STATUSES[value]?.current ?? null) : null;
}

export function appointmentStatusLabel(value: unknown): string {
  if (isAppointmentStatus(value)) return APPOINTMENT_STATUS_LABELS[value];
  return typeof value === "string" ? (LEGACY_APPOINTMENT_STATUSES[value]?.label ?? value) : "";
}

export const APPOINTMENT_SLOTS = ["morning", "evening", "full_day"] as const;
export type AppointmentSlot = (typeof APPOINTMENT_SLOTS)[number];
// The values (morning/evening) stay the same as in the database; only the display name changed.
export const APPOINTMENT_SLOT_LABELS: Record<AppointmentSlot, string> = { morning: "Öğleden önce", evening: "Öğleden sonra", full_day: "Tüm gün" };
/** Time slots offered for each day picked in the calendar, in display order. */
export const CALENDAR_APPOINTMENT_SLOTS = ["full_day", "morning", "evening"] as const satisfies readonly AppointmentSlot[];

// --- Document statuses ------------------------------------------------------

// Both lists are shown in this order in select lists: Turkish alphabetical by label (tested).
// The "Koşullu" (conditional) rule was removed (migration 26): a document is either required or optional.
export const DOCUMENT_REQUIREMENTS = ["optional", "required"] as const;
export type DocumentRequirement = (typeof DOCUMENT_REQUIREMENTS)[number];
export const DOCUMENT_REQUIREMENT_LABELS: Record<DocumentRequirement, string> = {
  optional: "İsteğe bağlı",
  required: "Zorunlu",
};

export const DOCUMENT_REVIEW_STATUSES = ["needs_correction", "missing", "pending", "approved"] as const;
export type DocumentReviewStatus = (typeof DOCUMENT_REVIEW_STATUSES)[number];
export const DOCUMENT_REVIEW_STATUS_LABELS: Record<DocumentReviewStatus, string> = {
  needs_correction: "Düzeltme gerekli",
  missing: "Eksik",
  pending: "İnceleme bekliyor",
  approved: "Kontrol edildi",
};

export function isDocumentReviewStatus(value: unknown): value is DocumentReviewStatus {
  return typeof value === "string" && (DOCUMENT_REVIEW_STATUSES as readonly string[]).includes(value);
}

// --- Files -------------------------------------------------------------------

export const FILE_KINDS = ["document", "payment_receipt", "staff_attachment", "visa_result", "appointment_letter", "extra_document"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const ALLOWED_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export const STORAGE_BUCKET = "application-files";

// --- Fees -------------------------------------------------------------------

export const CURRENCIES = ["TRY", "GBP", "USD", "EUR"] as const;
export type Currency = (typeof CURRENCIES)[number];
export const CURRENCY_LABELS: Record<Currency, string> = { TRY: "TL", GBP: "GBP", USD: "USD", EUR: "EUR" };
/** Display order in the select list: alphabetical by label (tested). */
export const CURRENCIES_BY_LABEL: readonly Currency[] = ["EUR", "GBP", "TRY", "USD"];

export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && (CURRENCIES as readonly string[]).includes(value);
}

export const FEE_KINDS = ["consultancy", "visa_fee", "city_surcharge", "other"] as const;

// --- Roles -------------------------------------------------------------------

export const USER_ROLES = ["customer", "staff"] as const;
export type UserRole = (typeof USER_ROLES)[number];
