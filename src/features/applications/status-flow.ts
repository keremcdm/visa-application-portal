import { needsCustomerAction, type DocumentSlotState } from "@/features/documents/rules";
import type { ApplicationStatus, AppointmentStatus, PaymentStatus } from "@/lib/domain/constants";

/**
 * AUTOMATIC STATUS RULE
 *
 * There is no status dropdown in the admin panel; the application status follows from what has been done:
 *  - once the payment is verified, "İnceleme aşamasında" (under review),
 *  - while something is expected from the customer (document problem, new document request, form correction, task)
 *    "Müşteriden işlem bekleniyor" (waiting on the customer), back to "İnceleme aşamasında" once done,
 *  - "Evraklar tamamlandı" (documents complete) with the consultant's button; removed if something new is requested from the customer,
 *  - once the appointment has taken place, "Sonuç bekleniyor" (awaiting result),
 *  - draft, cancelled and "Sonuç müşteriye bildirildi" only change through their own actions.
 *
 * The database enforces the rule (migration 12: private.next_application_status and private.customer_action_outstanding);
 * this counterpart is for the UI's buttons and descriptions. Tests under tests/db check that both give the same result.
 */

export function nextApplicationStatus(
  status: ApplicationStatus,
  paymentStatus: PaymentStatus,
  appointmentStatus: AppointmentStatus,
  outstanding: boolean,
): ApplicationStatus {
  if (status === "draft" || status === "cancelled" || status === "result_communicated") return status;
  if (paymentStatus !== "verified") return "submitted";
  if (appointmentStatus === "completed") return "awaiting_result";
  if (outstanding) return "awaiting_customer";
  if (status === "documents_complete" || status === "awaiting_result") return "documents_complete";
  return "in_review";
}

export type OutstandingInput = {
  status: ApplicationStatus;
  formLocked: boolean;
  slots: readonly DocumentSlotState[];
  tasks: readonly { status: "open" | "completed" | "cancelled" }[];
};

/** Things expected from the customer: how many documents, how many tasks, form correction. */
export type OutstandingActions = { documents: number; tasks: number; form: boolean; any: boolean };

export function outstandingCustomerActions(input: OutstandingInput): OutstandingActions {
  const documents = input.slots.filter(needsCustomerAction).length;
  const tasks = input.tasks.filter((task) => task.status === "open").length;
  const form = input.status !== "draft" && !input.formLocked;
  return { documents, tasks, form, any: documents > 0 || tasks > 0 || form };
}

/** Short summary such as "3 belge, 1 görev ve form düzeltmesi" (staff screen). */
export function describeOutstanding(actions: OutstandingActions): string {
  const parts: string[] = [];
  if (actions.documents > 0) parts.push(`${actions.documents} belge`);
  if (actions.tasks > 0) parts.push(`${actions.tasks} görev`);
  if (actions.form) parts.push("form düzeltmesi");
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} ve ${parts.at(-1)}`;
}

export type RuleResult = { ok: true } | { ok: false; message: string };

/** Can the consultant mark "Evraklar tamamlandı"? (A database trigger applies the same rule.) */
export function canMarkDocumentsComplete(status: ApplicationStatus, outstanding: OutstandingActions): RuleResult {
  if (status === "documents_complete") return { ok: false, message: "Evraklar zaten tamamlandı olarak işaretli." };
  if (status === "submitted") return { ok: false, message: "Ödeme doğrulanmadan evraklar tamamlandı olarak işaretlenemez." };
  if (status === "awaiting_customer" || outstanding.any) {
    return { ok: false, message: `Müşteriden beklenen işler tamamlanmadan evraklar tamamlandı olarak işaretlenemez (${describeOutstanding(outstanding)}).` };
  }
  if (status !== "in_review") return { ok: false, message: "Bu aşamada evraklar tamamlandı olarak işaretlenemez." };
  return { ok: true };
}

export function canUndoDocumentsComplete(status: ApplicationStatus): RuleResult {
  return status === "documents_complete" ? { ok: true } : { ok: false, message: "Evraklar tamamlandı olarak işaretli değil." };
}

/** Can the consultant cancel the application? A draft (the customer's) and an application whose result was sent cannot be cancelled. */
export function canCancelApplication(status: ApplicationStatus): RuleResult {
  if (status === "cancelled") return { ok: false, message: "Başvuru zaten iptal edildi." };
  if (status === "draft") return { ok: false, message: "Taslak başvuru iptal edilemez; müşteri gönderdiğinde işlem yapılabilir." };
  if (status === "result_communicated") return { ok: false, message: "Sonucu bildirilmiş başvuru iptal edilemez." };
  return { ok: true };
}

export function canReopenApplication(status: ApplicationStatus): RuleResult {
  return status === "cancelled" ? { ok: true } : { ok: false, message: "Başvuru iptal edilmedi." };
}

/** Can the appointment date be sent / new preferences be requested? For submitted, ongoing applications. */
export function canManageAppointment(status: ApplicationStatus): RuleResult {
  if (status === "draft") return { ok: false, message: "Başvuru henüz gönderilmedi." };
  if (status === "cancelled") return { ok: false, message: "İptal edilen başvuruda randevu işlemi yapılamaz." };
  if (status === "result_communicated") return { ok: false, message: "Sonucu bildirilmiş başvuruda randevu işlemi yapılamaz." };
  return { ok: true };
}
