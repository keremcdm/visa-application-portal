import type { ApplicationStatus, DocumentRequirement, DocumentReviewStatus } from "@/lib/domain/constants";

/**
 * Rules for the customer's actions on document slots (pure functions).
 * Server actions and the UI use the same rules.
 */

export type DocumentSlotState = {
  requirement: DocumentRequirement;
  outOfScope: boolean;
  reuploadAllowed: boolean;
  reviewStatus: DocumentReviewStatus;
  maxFiles: number;
  /** Number of verified (ready) files. */
  fileCount: number;
};

export type RuleResult = { ok: true } | { ok: false; message: string };

/** Can the customer change this slot (upload, delete)? */
export function canCustomerModifyDocument(applicationStatus: ApplicationStatus, slot: DocumentSlotState): boolean {
  if (applicationStatus === "cancelled") return false;
  return applicationStatus === "draft" || slot.reuploadAllowed;
}

export function canCustomerUpload(applicationStatus: ApplicationStatus, slot: DocumentSlotState): RuleResult {
  if (!canCustomerModifyDocument(applicationStatus, slot)) {
    return { ok: false, message: "Bu belge şu anda değiştirilemez. Değişiklik gerekiyorsa danışmanınız sizden talep edecektir." };
  }
  if (slot.outOfScope) {
    return { ok: false, message: "Bu belge seçtiğiniz başvuru tipinde istenmiyor." };
  }
  if (slot.fileCount >= slot.maxFiles) {
    return { ok: false, message: `Bu belge için en fazla ${slot.maxFiles} dosya yükleyebilirsiniz. Yeni dosya eklemek için önce birini siliniz.` };
  }
  return { ok: true };
}

export function canCustomerDeleteFile(applicationStatus: ApplicationStatus, slot: DocumentSlotState): RuleResult {
  if (!canCustomerModifyDocument(applicationStatus, slot)) {
    return { ok: false, message: "Bu dosya şu anda silinemez." };
  }
  return { ok: true };
}

export type DocumentCompletion = "complete" | "missing" | "optional_empty" | "out_of_scope";

export function documentCompletion(slot: DocumentSlotState): DocumentCompletion {
  if (slot.outOfScope) return "out_of_scope";
  if (slot.fileCount > 0) return "complete";
  if (slot.requirement === "optional") return "optional_empty";
  return "missing";
}

/** Slot that blocks submission: a required document that has not been uploaded. */
export function blocksSubmission(slot: DocumentSlotState): boolean {
  return documentCompletion(slot) === "missing";
}

/**
 * "x / y belge tamamlandı" in the Documents step's bottom bar: only required documents are counted. Optional documents do not
 * block submission so they are not counted; this way y − x always equals the "pending" count.
 */
export function documentProgress(slots: readonly DocumentSlotState[]): { done: number; total: number } {
  const counted = slots.filter((slot) => !slot.outOfScope && slot.requirement === "required");
  const done = counted.filter((slot) => documentCompletion(slot) === "complete").length;
  return { done, total: counted.length };
}

/** After submission, is this a slot waiting for action from the customer? */
export function needsCustomerAction(slot: DocumentSlotState): boolean {
  if (slot.outOfScope) return false;
  if (slot.reviewStatus === "needs_correction" || slot.reviewStatus === "missing") return true;
  return slot.reuploadAllowed && documentCompletion(slot) === "missing";
}

/**
 * Red warning under the document on the customer's Documents page of a submitted application: for a document needing correction, a document reported missing and a document newly requested by the consultant. The
 * warning disappears once the customer uploads the file. `note`: the note the consultant wrote for this document (if any).
 */
export function customerDocumentAlert(
  applicationStatus: ApplicationStatus,
  slot: DocumentSlotState,
  reviewNote: string | null,
): { title: string; note: string | null } | null {
  if (applicationStatus === "draft" || applicationStatus === "cancelled" || !needsCustomerAction(slot)) return null;
  if (slot.reviewStatus === "needs_correction") return { title: "Bu belgede düzeltme gerekiyor", note: reviewNote };
  if (reviewNote) return { title: "Bu belge eksik", note: reviewNote };
  return { title: "Danışmanınız bu belgeyi istiyor", note: null };
}
