import type { ApplicationStatus } from "@/lib/domain/constants";
import type { RuleResult } from "./status-flow";

/**
 * EDITING THE FORM OF A SUBMITTED APPLICATION
 *
 *  - The consultant can open the form for correction (on their own or at the customer's request); when done the customer
 *    says "Formu düzenlemeyi tamamladım", the form locks again and the correction notice disappears.
 *  - While the form is locked the customer can send the consultant a form edit request describing what they want to change;
 *    the consultant opens the form (request fulfilled) or refuses the request with a reason. Only one request can be pending at a time.
 *  - No request can be sent after the appointment (while the result is pending) or for a cancelled or concluded application.
 *
 * The database applies the same rules (migration 17: svc_request_form_edit, svc_finish_form_correction).
 */

export const FORM_EDIT_REQUEST_STATUSES: readonly ApplicationStatus[] = ["submitted", "in_review", "awaiting_customer", "documents_complete"];
export const FORM_EDIT_NOTE_MAX = 1000;

export type FormEditInput = { status: ApplicationStatus; formLocked: boolean; formEditRequestedAt: string | null };

/**
 * What the customer sees: "open" open for correction · "requested" request with the consultant · "can_request" can send a request ·
 * "closed" none (draft, after the appointment, cancelled, concluded).
 */
export type FormEditState = "open" | "requested" | "can_request" | "closed";

export function formEditState(input: FormEditInput): FormEditState {
  if (input.status === "draft" || input.status === "cancelled" || input.status === "result_communicated") return "closed";
  if (!input.formLocked) return "open";
  if (!FORM_EDIT_REQUEST_STATUSES.includes(input.status)) return "closed";
  return input.formEditRequestedAt ? "requested" : "can_request";
}

export function canRequestFormEdit(input: FormEditInput): RuleResult {
  switch (formEditState(input)) {
    case "can_request":
      return { ok: true };
    case "open":
      return { ok: false, message: "Formunuz zaten düzenlemeye açık." };
    case "requested":
      return { ok: false, message: "Form düzenleme isteğiniz danışmanınıza iletildi; yanıtını bekleyiniz." };
    case "closed":
      return { ok: false, message: "Bu aşamada form düzenleme isteği gönderilemez. Sorunuz için danışmanınıza mesaj yazabilirsiniz." };
  }
}

export function canFinishFormCorrection(input: FormEditInput): RuleResult {
  return formEditState(input) === "open" ? { ok: true } : { ok: false, message: "Formunuz şu anda düzenlemeye açık değil." };
}
