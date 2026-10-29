import { FORM_SECTIONS } from "@/features/application-form/definition";
import { pruneFormData, validateForm } from "@/features/application-form/engine";
import type { FormData, SectionId } from "@/features/application-form/types";
import { validateAlternativePreferences, validatePreferences, type AppointmentConfig } from "@/features/appointments/window";
import { blocksSubmission, type DocumentSlotState } from "@/features/documents/rules";
import {
  isApplicationType,
  isSponsorStatus,
  STATUSES_REQUIRING_VERIFIED_PAYMENT,
  VISA_OUTCOME_NOTE_MAX,
  VISA_OUTCOME_STATUSES,
  type ApplicationStatus,
  type PaymentStatus,
  type VisaOutcome,
} from "@/lib/domain/constants";

/**
 * Pre-submission checks, and the staff payment and visa outcome rules (pure functions).
 * Application status rule: status-flow.ts.
 * The server action calls `checkSubmission` before submitting; the UI shows the same result on the summary screen.
 */

/** The fee step does not block submission: no price is shown and uploading a receipt is optional. */
export type SubmissionStep = "type" | "form" | "documents" | "appointment";

export type SubmissionIssue = { step: SubmissionStep; message: string; sectionId?: SectionId };

export type SubmissionInput = {
  status: ApplicationStatus;
  applicationTypes: readonly string[];
  sponsorStatus: string | null;
  cityId: string | null;
  /** Active appointment cities defined by the company; the city is not asked if empty. */
  activeCityIds: readonly string[];
  formData: FormData;
  documents: ReadonlyArray<DocumentSlotState & { label: string }>;
  preferences: unknown;
  /** Did the customer say "Bu tarihlerin hiçbiri bana uymuyor" (none of these dates suit me)? Then 1–3 days are enough. */
  preferencesOutsideWindow?: boolean;
  today: string;
  appointmentConfig: AppointmentConfig;
};

export function checkSubmission(input: SubmissionInput): SubmissionIssue[] {
  const issues: SubmissionIssue[] = [];

  if (input.status !== "draft") {
    return [{ step: "type", message: "Bu başvuru daha önce gönderilmiş." }];
  }

  const types = input.applicationTypes.filter(isApplicationType);
  if (types.length === 0) {
    issues.push({ step: "type", message: "En az bir başvuru tipi seçmelisiniz." });
  }
  if (types.includes("sponsored") && !isSponsorStatus(input.sponsorStatus)) {
    issues.push({ step: "type", message: "Sponsorunuzun çalışma durumunu seçmelisiniz." });
  }
  const validation = validateForm(pruneFormData(input.formData), input.today);
  for (const section of FORM_SECTIONS) {
    if (validation.sections[section.id].errorCount > 0) {
      issues.push({
        step: "form",
        sectionId: section.id,
        message: `Başvuru formunun “${section.title}” bölümünde eksik veya hatalı alanlar var.`,
      });
    }
  }

  for (const document of input.documents) {
    if (!blocksSubmission(document)) continue;
    issues.push({ step: "documents", message: `“${document.label}” belgesi yüklenmedi.` });
  }

  // The appointment city is chosen in the appointment preference step.
  if (input.activeCityIds.length > 0 && (!input.cityId || !input.activeCityIds.includes(input.cityId))) {
    issues.push({ step: "appointment", message: "Randevu şehrini seçmelisiniz." });
  }
  const preferences = input.preferencesOutsideWindow
    ? validateAlternativePreferences(input.preferences, input.today, input.appointmentConfig)
    : validatePreferences(input.preferences, input.today, input.appointmentConfig);
  if (!preferences.ok) {
    issues.push({ step: "appointment", message: preferences.message });
  }

  return issues;
}

export type RuleResult = { ok: true } | { ok: false; message: string };

/** Can staff record the visa outcome? (The database function svc_set_visa_outcome applies the same rules separately.) */
export function canStaffSetVisaOutcome(status: ApplicationStatus, paymentStatus: PaymentStatus, outcome: VisaOutcome, note: string): RuleResult {
  if (!VISA_OUTCOME_STATUSES.includes(status)) {
    return { ok: false, message: "Vize sonucu, evraklar tamamlandıktan sonra bildirilebilir." };
  }
  if (paymentStatus !== "verified") return { ok: false, message: "Ödeme doğrulanmadan sonuç bildirilemez." };
  if (outcome === "refused" && note.trim() === "") return { ok: false, message: "Ret sebebini yazınız." };
  if (note.trim().length > VISA_OUTCOME_NOTE_MAX) return { ok: false, message: `Açıklama en fazla ${VISA_OUTCOME_NOTE_MAX} karakter olabilir.` };
  return { ok: true };
}

export type PaymentDecision = "verify" | "reject";

export function canStaffReviewPayment(
  status: ApplicationStatus,
  paymentStatus: PaymentStatus,
  decision: PaymentDecision,
  note: string,
): RuleResult {
  if (status === "draft" || paymentStatus === "not_due") {
    return { ok: false, message: "Başvuru henüz gönderilmediği için ödeme incelenemez." };
  }
  if (decision === "verify") {
    if (paymentStatus === "verified") return { ok: false, message: "Ödeme zaten doğrulanmış." };
    return { ok: true };
  }
  // A verified payment moves the application to review automatically; verification cannot be undone after that.
  if (paymentStatus === "verified" && STATUSES_REQUIRING_VERIFIED_PAYMENT.includes(status)) {
    return { ok: false, message: "Ödeme doğrulandığı için başvuru inceleme aşamasına geçti; doğrulama geri alınamaz." };
  }
  if (paymentStatus === "rejected") return { ok: false, message: "Ödeme zaten doğrulanamadı olarak işaretli." };
  if (note.trim() === "") {
    return { ok: false, message: "Ödemeyi neden doğrulayamadığınızı müşteriye açıklayan bir not yazınız." };
  }
  return { ok: true };
}

export function canCustomerDeclarePayment(paymentStatus: PaymentStatus): RuleResult {
  if (paymentStatus === "awaiting_payment" || paymentStatus === "rejected") return { ok: true };
  if (paymentStatus === "under_review") return { ok: false, message: "Ödeme bildiriminiz alındı; danışmanlarımız kontrol ediyor." };
  if (paymentStatus === "verified") return { ok: false, message: "Ödemeniz zaten doğrulandı." };
  return { ok: false, message: "Bu başvuru için henüz ödeme beklenmiyor." };
}
