import type { ApplicationStatus } from "@/lib/domain/constants";

/**
 * ADMIN DELETION OF AN APPLICATION
 *
 * Only an admin can delete (like staff management; the database checks too). Deletion is permanent: the application, form
 * answers, documents, messages, notes and tasks are removed; the customer's account stays. A draft is deleted with a single
 * confirmation; for a submitted application the application number must be typed to prevent accidental deletion.
 */

export function deletionNeedsReference(status: ApplicationStatus): boolean {
  return status !== "draft";
}

/** Does the typed confirmation match the application number (ignoring spaces and case)? */
export function referenceConfirmed(referenceCode: string, typed: string): boolean {
  const normalize = (value: string) => value.replace(/\s+/g, "").toLocaleUpperCase("tr-TR");
  return normalize(typed) !== "" && normalize(typed) === normalize(referenceCode);
}

export function canDeleteApplication(
  status: ApplicationStatus,
  referenceCode: string,
  typed: string,
): { ok: true } | { ok: false; message: string } {
  if (deletionNeedsReference(status) && !referenceConfirmed(referenceCode, typed)) {
    return { ok: false, message: "Silmeyi onaylamak için başvuru numarasını eksiksiz yazınız." };
  }
  return { ok: true };
}
