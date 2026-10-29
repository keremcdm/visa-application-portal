import { VISA_OUTCOME_STATUSES, type ApplicationStatus, type PaymentStatus } from "@/lib/domain/constants";
import { canAddExtraDocument } from "./extra-documents";
import { canCustomerUpload, type DocumentSlotState } from "./rules";

/**
 * Decides whether a user can upload a file to a given target (pure function).
 * The server action applies this decision both when issuing the upload URL and when confirming the file.
 */

export type UploadActor = { id: string; isStaff: boolean };

export type UploadApplication = { customerId: string; status: ApplicationStatus; paymentStatus: PaymentStatus };

export type UploadRequest =
  | { kind: "document"; slot: DocumentSlotState | null }
  | { kind: "staff_attachment"; slot: DocumentSlotState | null }
  | { kind: "payment_receipt"; receiptUploadEnabled: boolean; existingReceiptCount: number }
  /** Screenshot of the visa outcome: staff only, after the visa application has been made. */
  | { kind: "visa_result" }
  /** Appointment letter: staff only, in a submitted application that is not cancelled. */
  | { kind: "appointment_letter" }
  /** Extra document after submission: the applicant only, up to the limit in Settings. */
  | { kind: "extra_document"; uploadedCount: number; limit: number };

export type UploadDecision = { ok: true } | { ok: false; reason: "forbidden" | "not_found" | "rule"; message: string };

export const MAX_RECEIPTS = 5;

const FORBIDDEN: UploadDecision = { ok: false, reason: "forbidden", message: "Bu işlem için yetkiniz bulunmuyor." };
const NOT_FOUND: UploadDecision = { ok: false, reason: "not_found", message: "Kayıt bulunamadı." };
const rule = (message: string): UploadDecision => ({ ok: false, reason: "rule", message });

export function decideUpload(actor: UploadActor, application: UploadApplication, request: UploadRequest): UploadDecision {
  const isOwner = application.customerId === actor.id;
  // Nobody who is neither the application's owner nor staff can upload to any target.
  if (!isOwner && !actor.isStaff) return FORBIDDEN;

  if (request.kind === "visa_result") {
    if (!actor.isStaff) return FORBIDDEN;
    return VISA_OUTCOME_STATUSES.includes(application.status) ? { ok: true } : rule("Vize sonucu, vize başvurusu yapıldıktan sonra eklenebilir.");
  }

  if (request.kind === "appointment_letter") {
    if (!actor.isStaff) return FORBIDDEN;
    return application.status === "draft" || application.status === "cancelled"
      ? rule("Randevu belgesi yalnızca gönderilmiş ve iptal edilmemiş başvuruya eklenebilir.")
      : { ok: true };
  }

  if (request.kind === "extra_document") {
    // The customer sends extra documents themselves; staff do not add extra documents on the customer's behalf (they request a document if needed).
    if (!isOwner) return FORBIDDEN;
    const extraRule = canAddExtraDocument(application.status, request.uploadedCount, request.limit);
    return extraRule.ok ? { ok: true } : rule(extraRule.message);
  }

  if (request.kind === "payment_receipt") {
    // Only the applicant uploads the receipt; staff cannot add a receipt on the customer's behalf.
    if (!isOwner) return FORBIDDEN;
    if (!request.receiptUploadEnabled) return rule("Dekont yükleme şu anda kapalıdır.");
    // In a draft a receipt can optionally be uploaded in the "Ücret" (fee) step; after submission while payment is pending.
    const paymentOpen = ["awaiting_payment", "under_review", "rejected"].includes(application.paymentStatus);
    if (application.status !== "draft" && !paymentOpen) {
      return rule("Bu başvuru için şu anda dekont yüklenemez.");
    }
    if (request.existingReceiptCount >= MAX_RECEIPTS) return rule(`En fazla ${MAX_RECEIPTS} dekont yükleyebilirsiniz.`);
    return { ok: true };
  }

  if (!request.slot) return NOT_FOUND;

  if (request.kind === "staff_attachment") {
    // Only staff can add a document to send to the customer.
    return actor.isStaff ? { ok: true } : FORBIDDEN;
  }

  if (actor.isStaff) {
    // Staff can add a document the customer delivered another way on their behalf (the file count limit applies).
    if (request.slot.fileCount >= request.slot.maxFiles) return rule(`Bu belge için en fazla ${request.slot.maxFiles} dosya yüklenebilir.`);
    return { ok: true };
  }

  const customerRule = canCustomerUpload(application.status, request.slot);
  return customerRule.ok ? { ok: true } : rule(customerRule.message);
}
