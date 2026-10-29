import "server-only";
import { after } from "next/server";
import { STORAGE_BUCKET } from "@/lib/domain/constants";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { logError, logWarning } from "./log";

/**
 * RETENTION PERIOD FOR CLOSED APPLICATIONS
 *
 * If a period (months) is set in Settings → General, applications that were concluded or cancelled and have been closed
 * longer than this period are permanently deleted: first the files in storage, then the database records. If no period is
 * set nothing happens. The database decides which applications are deleted (the condition is re-checked at deletion time);
 * this file takes no outside input. No personal data is logged.
 */

type Expired = { application_id: string; reference_code: string; storage_paths: string[] | null };

export type RetentionResult = { deleted: number; skipped: number };

export async function runRetentionCleanup(): Promise<RetentionResult> {
  if (!isAdminClientConfigured()) return { deleted: 0, skipped: 0 };
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("svc_expired_applications", { p_limit: 20 });
  if (error) {
    // Without migration 16 the function does not exist.
    if (error.code === "PGRST202" || error.code === "42883") return { deleted: 0, skipped: 0 };
    logError("retention.list", error);
    return { deleted: 0, skipped: 0 };
  }
  let deleted = 0;
  let skipped = 0;
  for (const row of (data ?? []) as Expired[]) {
    const paths = (row.storage_paths ?? []).filter((p) => typeof p === "string" && p.startsWith(`${row.application_id}/`));
    if (paths.length > 0) {
      const { error: storageError } = await admin.storage.from(STORAGE_BUCKET).remove(paths);
      if (storageError) {
        // If the files cannot be deleted the record is not deleted either (so the file paths are not lost); it is retried on the next run.
        logError("retention.storage", storageError);
        skipped += 1;
        continue;
      }
    }
    const { data: removed, error: deleteError } = await admin.rpc("svc_delete_expired_application", { p_application_id: row.application_id });
    if (deleteError) {
      logError("retention.delete", deleteError);
      skipped += 1;
    } else if (removed === true) deleted += 1;
    else skipped += 1;
  }
  if (deleted > 0) logWarning("retention.deleted", { count: deleted });
  return { deleted, skipped };
}

let lastRun = 0;
const INTERVAL_MS = 60 * 60 * 1000;

/**
 * Runs when staff open the admin panel, after the response is sent, at most once an hour (no separate scheduled job
 * needed). Only called from requests where staff permission has been verified.
 */
export function scheduleRetentionCleanup(): void {
  const now = Date.now();
  if (now - lastRun < INTERVAL_MS) return;
  lastRun = now;
  after(async () => {
    try {
      await runRetentionCleanup();
    } catch (error) {
      logError("retention.run", error);
    }
  });
}
