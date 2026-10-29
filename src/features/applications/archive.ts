import type { ApplicationStatus } from "@/lib/domain/constants";

/**
 * PAST APPLICATIONS
 * An application that is concluded (result sent to the customer) or cancelled leaves the navy card on the home page about
 * two weeks after entering that status and moves to the "Eski başvuruları göster" (show past applications) section.
 */

export const ARCHIVE_AFTER_DAYS = 14;

const FINISHED_STATUSES: readonly ApplicationStatus[] = ["result_communicated", "cancelled"];

export function isFinishedStatus(status: ApplicationStatus): boolean {
  return FINISHED_STATUSES.includes(status);
}

/**
 * When the application entered its current (final) status: the last transition to it in the status history. If the
 * history cannot be read, `fallback` is used (e.g. when the result was sent or the last update).
 */
export function finishedAt(
  status: ApplicationStatus,
  history: readonly { status: string; changedAt: string }[],
  fallback: string | null,
): string | null {
  if (!isFinishedStatus(status)) return null;
  const entries = history.filter((h) => h.status === status && h.changedAt);
  return entries.length > 0 ? entries.reduce((latest, h) => (h.changedAt > latest ? h.changedAt : latest), entries[0]!.changedAt) : fallback;
}

/** A finished application moves to past applications at least ARCHIVE_AFTER_DAYS days after it finished. */
export function isArchived(status: ApplicationStatus, finishedIso: string | null, now: Date): boolean {
  if (!isFinishedStatus(status) || !finishedIso) return false;
  const finished = new Date(finishedIso).getTime();
  if (Number.isNaN(finished)) return false;
  return now.getTime() - finished >= ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}
