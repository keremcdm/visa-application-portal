import { needsCustomerAction, type DocumentSlotState } from "@/features/documents/rules";
import type { ApplicationStatus, AppointmentStatus, PaymentStatus } from "@/lib/domain/constants";
import { formatDateTimeTr } from "@/lib/validation/formats";

/**
 * CUSTOMER PANEL — APPLICATION STEPS AND ALERTS
 *
 * The navy card on the home page and the timeline on the application status page use the same
 * rule. Steps are computed from the application status, payment and appointment status, document requests and the
 * status history.
 *
 * the timeline has 7 steps:
 *   1. Application received · 2. Payment · 3. Review · 4. Extra documents / correction (if needed) · 5. Appointment ·
 *   6. Appointment day (then "Başvurunuz tamamlandı") · 7. Result
 * The application is never shown as "under review" before the payment is verified; once the documents are complete and
 * there is no appointment yet it says "Randevunuz danışmanınız tarafından bildirilecek" (your consultant will send the
 * appointment; "appointment created" is not shown).
 *
 * When something is expected from the customer (payment could not be verified, extra document / correction, form correction,
 * task, new appointment preference) the related step is shown with a red exclamation and the card lists each one clearly
 * under "Sizden beklenenler". For a cancelled application the step where it was cancelled shows a red cross.
 *
 * A date is only shown for steps where it is actually known; otherwise it says "Tamamlandı" (completed).
 * No text implies that the company makes the visa decision.
 */

export type ProgressStepKey = "received" | "payment" | "review" | "extra_documents" | "appointment" | "lodged" | "result";

/** `attention`: action expected from the customer (red exclamation). `cancelled`: the application was cancelled at this step. */
export type ProgressStepState = "done" | "current" | "pending" | "attention" | "cancelled";

export type ProgressStep = {
  key: ProgressStepKey;
  /** Short name in the timeline; changes with the step's state ("Ödemeniz bekleniyor" → "Ödemeniz doğrulandı"). */
  label: string;
  /** Card title when this is the current step (usually the same as `label`). */
  title: string;
  state: ProgressStepState;
  /** Short info below the ring: date, "Devam ediyor", "Bekliyor", "İşlem bekleniyor". */
  meta: string;
  /** Description of the step (the card text for the current step). */
  description: string;
};

/** Tasks expected from the customer, spelled out on the card. */
export type ProgressAlert =
  | { kind: "payment_rejected"; note: string | null }
  | { kind: "documents"; count: number }
  | { kind: "form" }
  | { kind: "task"; title: string }
  | { kind: "appointment_preferences" };

export type ApplicationProgress =
  | {
      kind: "active";
      steps: ProgressStep[];
      /** Index of the current step; null if the application is concluded. */
      currentIndex: number | null;
      completed: number;
      alerts: ProgressAlert[];
    }
  | {
      kind: "cancelled";
      /** Steps at the moment of cancellation; the step where it was cancelled is in the `cancelled` state. */
      steps: ProgressStep[];
      currentIndex: number;
      alerts: [];
    };

export type ExtraDocuments = {
  /** The consultant requested an extra document or a correction to documents (now or earlier). */
  requested: boolean;
  /** A document upload or correction is still expected from the customer. */
  outstanding: boolean;
  /** Number of documents awaiting action from the customer. */
  outstandingCount: number;
};

/**
 * "Extra documents" info from the document slots: did the consultant request an extra document or a correction, and is it still pending?
 * The home page and the application status page use the same rule.
 */
export function extraDocumentsFrom(slots: readonly (DocumentSlotState & { requestedByStaff: boolean })[]): ExtraDocuments {
  const outstandingCount = slots.filter((slot) => needsCustomerAction(slot)).length;
  return {
    requested: slots.some((slot) => slot.requestedByStaff || slot.reviewStatus === "needs_correction" || slot.reviewStatus === "missing"),
    outstanding: outstandingCount > 0,
    outstandingCount,
  };
}

export type ProgressInput = {
  status: ApplicationStatus;
  appointmentStatus: AppointmentStatus;
  paymentStatus: PaymentStatus;
  /** The consultant's explanation if the payment could not be verified. */
  paymentNote: string | null;
  paymentReviewedAt: string | null;
  submittedAt: string | null;
  appointmentAt: string | null;
  /** application_status_history: submission and status changes, oldest first. */
  history: readonly { status: string; changedAt: string }[];
  visaOutcomeAt: string | null;
  extraDocuments: ExtraDocuments;
  /** In a submitted application the form is open for the customer to correct. */
  formOpen: boolean;
  /** Titles of tasks given by the consultant that the customer has not completed yet. */
  openTasks: readonly string[];
};

/**
 * Step names: shown for a pending step and in the faded timeline of a cancelled application. They are short
 * descriptive sentences.
 */
export const PROGRESS_STEP_NAMES: Record<ProgressStepKey, string> = {
  received: "Başvurunuz alındı",
  payment: "Ödemeniz doğrulandı",
  review: "Başvurunuz inceleniyor",
  extra_documents: "Ek evrak istendi",
  appointment: "Randevunuz oluşturuldu",
  lodged: "Başvurunuz tamamlandı",
  result: "Başvurunuz sonuçlandı",
};

const STEP_KEYS: readonly ProgressStepKey[] = ["received", "payment", "review", "extra_documents", "appointment", "lodged", "result"];

const ISTANBUL_DATE = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric" });

/** Date of the timestamp in Istanbul: "14.10.2026". */
export function istanbulDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : ISTANBUL_DATE.format(date);
}

// The history may also contain old names (records from before database migration 12).
const CORRECTION_STATUSES: readonly string[] = ["awaiting_customer", "correction_required"];
const LODGED_STATUSES: readonly string[] = ["awaiting_result", "visa_submitted"];
const APPOINTMENT_SET: readonly AppointmentStatus[] = ["scheduled", "completed"];

/** Tasks expected from the customer (none for a cancelled application). */
export function progressAlerts(input: ProgressInput): ProgressAlert[] {
  if (input.status === "cancelled" || input.status === "draft") return [];
  const alerts: ProgressAlert[] = [];
  if (input.paymentStatus === "rejected") alerts.push({ kind: "payment_rejected", note: input.paymentNote?.trim() || null });
  if (input.extraDocuments.outstandingCount > 0) alerts.push({ kind: "documents", count: input.extraDocuments.outstandingCount });
  if (input.formOpen) alerts.push({ kind: "form" });
  for (const title of input.openTasks) alerts.push({ kind: "task", title });
  if (input.appointmentStatus === "preferences_requested") alerts.push({ kind: "appointment_preferences" });
  return alerts;
}

/** Title and description of the alert on the card. */
export function progressAlertText(alert: ProgressAlert): { title: string; text: string } {
  switch (alert.kind) {
    case "payment_rejected":
      return {
        title: "Ödemeniz doğrulanamadı",
        text: alert.note ? `Danışmanınızın açıklaması: ${alert.note}` : "Ayrıntı için başvurunuzun Ödeme bölümüne bakınız.",
      };
    case "documents":
      return {
        title: alert.count === 1 ? "1 belge için işlem bekleniyor" : `${alert.count} belge için işlem bekleniyor`,
        text: "Danışmanınız ek belge veya belgelerinizde düzeltme istedi. Başvurunuzun Evraklar bölümünden yükleyiniz.",
      };
    case "form":
      return {
        title: "Başvuru formunuzda düzeltme isteniyor",
        text: "Formu düzenledikten sonra “Formu düzenlemeyi tamamladım” düğmesine basınız.",
      };
    case "task":
      return { title: "Danışmanınız sizden bir işlem talep etti", text: alert.title };
    case "appointment_preferences":
      return {
        title: "Yeni randevu tercihi bekleniyor",
        text: "Başvurunuzdaki “Tercih bildir” ile uygun olduğunuz günleri seçiniz.",
      };
  }
}

/** Current main step, ignoring the extra-documents step; null if concluded or cancelled. */
function mainStep(input: ProgressInput): Exclude<ProgressStepKey, "extra_documents" | "received"> | null {
  switch (input.status) {
    case "draft":
      return "payment";
    case "submitted":
      return input.paymentStatus === "verified" ? "review" : "payment";
    case "in_review":
    case "awaiting_customer":
      return "review";
    case "documents_complete":
      return APPOINTMENT_SET.includes(input.appointmentStatus) ? "lodged" : "appointment";
    case "awaiting_result":
      return "result";
    case "result_communicated":
    case "cancelled":
      return null;
  }
}

export function buildApplicationProgress(input: ProgressInput): ApplicationProgress {
  if (input.status === "cancelled") return cancelledProgress(input);

  const alerts = progressAlerts(input);
  const correctionInHistory = input.history.some((h) => CORRECTION_STATUSES.includes(h.status));
  const inCorrection = CORRECTION_STATUSES.includes(input.status);
  // Exclamation on the extra-documents step: a document, the form or a task is pending.
  const extraAttention = inCorrection || input.extraDocuments.outstanding || input.formOpen || input.openTasks.length > 0;
  const extraRequested = extraAttention || input.extraDocuments.requested || correctionInHistory;
  const paymentRejected = input.paymentStatus === "rejected";
  const preferencesRequested = input.appointmentStatus === "preferences_requested";

  const main = mainStep(input);
  // While something is expected from the customer and the application has not reached the appointment stage, the current step is extra documents.
  const currentKey: ProgressStepKey | null = extraAttention && main === "review" ? "extra_documents" : main;
  const currentIndex = currentKey === null ? null : STEP_KEYS.indexOf(currentKey);
  const reachedAt = (statuses: readonly string[]): string | null => input.history.find((h) => statuses.includes(h.status))?.changedAt ?? null;
  // A date is only shown for a sent or completed appointment.
  const appointmentSet = Boolean(input.appointmentAt) && APPOINTMENT_SET.includes(input.appointmentStatus);
  const appointment = appointmentSet ? formatDateTimeTr(input.appointmentAt!) : null;

  const doneDate: Record<ProgressStepKey, string | null> = {
    received: input.submittedAt ?? reachedAt(["submitted"]),
    payment: (input.paymentStatus === "verified" ? input.paymentReviewedAt : null) ?? reachedAt(["in_review"]),
    review: reachedAt(["documents_complete"]),
    extra_documents: reachedAt(CORRECTION_STATUSES),
    appointment: appointmentSet ? input.appointmentAt : null,
    lodged: reachedAt(LODGED_STATUSES),
    result: input.visaOutcomeAt ?? reachedAt(["result_communicated"]),
  };

  const stateOf = (key: ProgressStepKey, index: number): ProgressStepState => {
    if (key === "payment" && paymentRejected) return "attention";
    if (key === "extra_documents" && extraAttention) return "attention";
    if (key === "appointment" && preferencesRequested) return "attention";
    if (currentIndex === null || index < currentIndex) return "done";
    if (index === currentIndex) return "current";
    // Requested but no longer pending (the customer completed it, the application went back to review).
    return key === "extra_documents" && extraRequested ? "done" : "pending";
  };

  const steps = STEP_KEYS.map((key, index): ProgressStep => {
    const state = stateOf(key, index);
    const text = stepText(key, state, input, { appointment, extraRequested });
    const date = doneDate[key];
    const meta =
      state === "done"
        ? key === "extra_documents" && !extraRequested
          ? "Gerekmedi"
          : date
            ? istanbulDate(date)
            : "Tamamlandı"
        : state === "attention"
          ? "İşlem bekleniyor"
          : state === "current"
            ? key === "payment" && input.paymentStatus === "under_review"
              ? "Kontrol ediliyor"
              : "Devam ediyor"
            : "Bekliyor";
    return { key, state, meta, ...text };
  });

  const completed = steps.filter((s) => s.state === "done").length;
  return { kind: "active", steps, currentIndex, completed, alerts };
}

/** Name, title and description of the step depending on its state. */
function stepText(
  key: ProgressStepKey,
  state: ProgressStepState,
  input: ProgressInput,
  { appointment, extraRequested }: { appointment: string | null; extraRequested: boolean },
): { label: string; title: string; description: string } {
  const same = (label: string, description: string) => ({ label, title: label, description });
  switch (key) {
    case "received":
      return same(PROGRESS_STEP_NAMES.received, "Başvurunuz bize ulaştı.");
    case "payment":
      if (state === "done") return same("Ödemeniz doğrulandı", "Ödemeniz danışmanlarımız tarafından doğrulandı.");
      if (state === "attention") {
        return same(
          "Ödemeniz doğrulanamadı",
          "Danışmanınız ödemenizi doğrulayamadı. Ödemenizi kontrol edip gerekiyorsa yeni dekont yükleyerek yeniden “Ödemeyi yaptım” ile bildiriniz.",
        );
      }
      if (state === "pending") return same(PROGRESS_STEP_NAMES.payment, "Ödemeniz doğrulandıktan sonra başvurunuzun incelenmesine başlanır.");
      if (input.paymentStatus === "under_review") {
        return same(
          "Ödemeniz kontrol ediliyor",
          "Ödeme bildiriminiz alındı. Danışmanlarımız banka hesabını kontrol ettikten sonra ödemeniz doğrulanacak ve başvurunuzun incelenmesine başlanacak.",
        );
      }
      return same(
        "Ödemeniz bekleniyor",
        "Başvurunuz bize ulaştı. Danışmanımızla anlaştığınız ücreti banka havalesiyle ödeyip başvurunuzdaki “Ödemeyi yaptım” düğmesiyle bildiriniz. İnceleme, ödemeniz doğrulandıktan sonra başlar.",
      );
    case "review":
      if (state === "done") return same("Başvurunuz incelendi", "Bilgileriniz ve belgeleriniz incelendi.");
      if (state === "pending") return same(PROGRESS_STEP_NAMES.review, "Ödemeniz doğrulandıktan sonra danışmanlarımız bilgi ve belgelerinizi inceleyecek.");
      return same(
        "Başvurunuz inceleniyor",
        "Danışmanlarımız bilgi ve belgelerinizi inceliyor. Sizden bir işlem gerekirse burada ve bildirimlerinizde göreceksiniz.",
      );
    case "extra_documents":
      if (state === "attention") {
        return same("Sizden işlem bekleniyor", "Danışmanınız sizden bir işlem istedi. Aşağıda yazan işleri tamamlayınız; ayrıntılar başvurunuzdadır.");
      }
      if (state === "done") {
        return extraRequested
          ? same(PROGRESS_STEP_NAMES.extra_documents, "İstenen ek evrak ve düzeltmeler tamamlandı.")
          : same(PROGRESS_STEP_NAMES.extra_documents, "Danışmanınız ek evrak veya düzeltme istemedi.");
      }
      return same(PROGRESS_STEP_NAMES.extra_documents, "Danışmanınız gerekirse sizden ek belge veya düzeltme isteyebilir.");
    case "appointment":
      if (state === "done") return same("Randevunuz oluşturuldu", appointment ? `Randevunuz: ${appointment}.` : "Randevunuz oluşturuldu.");
      if (state === "attention") {
        return same("Yeni randevu tercihi bekleniyor", "Danışmanınız sizden yeni randevu tercihleri istedi.");
      }
      if (state === "pending") return same(PROGRESS_STEP_NAMES.appointment, "Evraklarınız tamamlandıktan sonra randevunuz danışmanınız tarafından alınıp size bildirilir.");
      return {
        label: "Randevunuz bildirilecek",
        title: "Randevunuz danışmanınız tarafından bildirilecek",
        description: "Evraklarınız tamamlandı. Danışmanınız randevu tercihlerinizi dikkate alarak randevunuzu alacak ve tarihi size bildirecek.",
      };
    case "lodged":
      if (state === "done") return same("Başvurunuz tamamlandı", "Randevunuzun saati geçti; vize başvurunuz ilgili makama yapıldı.");
      if (state === "pending") return same(PROGRESS_STEP_NAMES.lodged, "Randevunuza katıldıktan sonra başvurunuz tamamlanır.");
      return {
        label: "Randevu gününüz bekleniyor",
        title: "Randevunuz oluşturuldu",
        description: appointment
          ? `Randevunuz ${appointment} tarihinde. Randevunuza katıldıktan sonra başvurunuz tamamlanır.`
          : "Randevunuza katıldıktan sonra başvurunuz tamamlanır.",
      };
    case "result":
      if (state === "done") return same("Başvurunuz sonuçlandı", "Yetkili makamın verdiği sonuç size bildirildi.");
      if (state === "pending") return same(PROGRESS_STEP_NAMES.result, "Vize kararını yetkili makam verir. Sonuç açıklandığında burada göreceksiniz.");
      return same("Sonuç bekleniyor", "Vize kararını yetkili makam verir. Sonuç açıklandığında size bildirilecek ve burada göreceksiniz.");
  }
}

/** Cancelled application: the steps of the status before cancellation, with the step where it was cancelled marked by a red cross. */
function cancelledProgress(input: ProgressInput): ApplicationProgress {
  const lastCancel = input.history.map((h) => h.status).lastIndexOf("cancelled");
  const before = lastCancel > 0 ? input.history[lastCancel - 1]!.status : "submitted";
  const previous = toPreviousStatus(before);
  // Nothing is expected from the customer for a cancelled application; steps are computed without alerts.
  const active = buildApplicationProgress({
    ...input,
    status: previous,
    paymentStatus: input.paymentStatus === "rejected" ? "awaiting_payment" : input.paymentStatus,
    appointmentStatus: input.appointmentStatus === "preferences_requested" ? "preferences_submitted" : input.appointmentStatus,
    extraDocuments: { ...input.extraDocuments, outstanding: false, outstandingCount: 0 },
    formOpen: false,
    openTasks: [],
  });
  if (active.kind !== "active") return active;
  const index = active.currentIndex ?? active.steps.length - 1;
  const steps = active.steps.map((step, i): ProgressStep => {
    if (i === index) return { ...step, state: "cancelled", meta: "İptal edildi", description: "Bu başvuru iptal edildi." };
    if (i > index) return { ...step, label: PROGRESS_STEP_NAMES[step.key], title: PROGRESS_STEP_NAMES[step.key], state: "pending", meta: "Bekliyor" };
    return step;
  });
  return { kind: "cancelled", steps, currentIndex: index, alerts: [] };
}

/** Maps a status text from the history (including old names) to a known status for the pre-cancellation computation. */
function toPreviousStatus(status: string): ApplicationStatus {
  switch (status) {
    case "in_review":
    case "awaiting_customer":
    case "documents_complete":
    case "awaiting_result":
    case "result_communicated":
      return status;
    case "correction_required":
      return "awaiting_customer";
    case "visa_submitted":
      return "awaiting_result";
    default:
      return "submitted";
  }
}
