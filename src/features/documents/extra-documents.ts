import type { ApplicationStatus } from "@/lib/domain/constants";
import type { RuleResult } from "./rules";

/**
 * EXTRA DOCUMENTS AFTER SUBMISSION
 *
 * After submitting the application the customer can send extra documents without asking the consultant. They cannot change
 * the documents uploaded at submission; an extra document is a separate file type ("extra_document") that the customer cannot
 * delete. The maximum count comes from Settings → General. The database checks the same rule with a trigger (migration 26,
 * private.application_files_extra_guard); the status list and the default limit are the same there.
 */

export const EXTRA_DOCUMENT_LIMIT_KEY = "documents.extra_max";
export const DEFAULT_EXTRA_DOCUMENT_LIMIT = 10;
/** Largest limit that can be entered in Settings. */
export const MAX_EXTRA_DOCUMENT_LIMIT = 50;

/** Statuses in which extra documents can be sent: submitted, not concluded and not cancelled. */
export const EXTRA_DOCUMENT_STATUSES: readonly ApplicationStatus[] = [
  "submitted",
  "in_review",
  "awaiting_customer",
  "documents_complete",
  "awaiting_result",
];

/** The limit from Settings; if it is not a number (left empty or never entered) the default applies. */
export function extraDocumentLimitFrom(settings: Readonly<Record<string, unknown>>): number {
  const value = settings[EXTRA_DOCUMENT_LIMIT_KEY];
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : DEFAULT_EXTRA_DOCUMENT_LIMIT;
}

/** Has the application progressed far enough to show the extra documents section (submitted and not cancelled)? */
export function showsExtraDocuments(status: ApplicationStatus): boolean {
  return status !== "draft" && status !== "cancelled";
}

/** Can the customer send one more extra document now? `uploadedCount`: number of verified (ready) extra documents. */
export function canAddExtraDocument(status: ApplicationStatus, uploadedCount: number, limit: number): RuleResult {
  if (!EXTRA_DOCUMENT_STATUSES.includes(status)) {
    return { ok: false, message: "Ek evrak, başvurunuz gönderildikten sonra ve sonuçlanana kadar gönderilebilir." };
  }
  if (limit <= 0) return { ok: false, message: "Ek evrak gönderimi şu anda kapalıdır." };
  if (uploadedCount >= limit) return { ok: false, message: `En fazla ${limit} ek evrak gönderebilirsiniz; bu sınıra ulaştınız.` };
  return { ok: true };
}

/**
 * Extra documents no consultant has opened yet: the "Yeni ek evrak" (new extra document) marker in the Applications list
 * shows until a consultant opens or downloads that extra document (the "file.viewed" entry in the audit log).
 * No new database migration is needed; viewing is already recorded.
 */
export function unseenExtraDocumentIds(
  files: readonly { id: string; kind: string; status: string }[],
  viewedFileIds: ReadonlySet<string>,
): string[] {
  return files.filter((f) => f.kind === "extra_document" && f.status === "ready" && !viewedFileIds.has(f.id)).map((f) => f.id);
}

/** Ids of the viewed files from the "file.viewed" entries in the audit log. */
export function viewedFileIdsFrom(entries: readonly { action: string; details: unknown }[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (entry.action !== "file.viewed" || typeof entry.details !== "object" || entry.details === null) continue;
    const fileId = (entry.details as { file_id?: unknown }).file_id;
    if (typeof fileId === "string") ids.add(fileId);
  }
  return ids;
}
