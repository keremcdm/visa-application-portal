import "server-only";
import { STORAGE_BUCKET } from "@/lib/domain/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "./log";

/**
 * ACCOUNT DELETION
 *
 * The caller uses this AFTER VERIFYING identity and permission (the customer themselves or active staff).
 * Steps:
 *   1. svc_delete_account_data: applies the business rule in the database too (customer themselves → no submitted
 *      application; staff → a pending deletion request exists), deletes applications and related records, returns the files' storage paths.
 *   2. Files in storage are deleted.
 *   3. The Auth user is deleted; the profile, notifications, risk test and deletion request go with it.
 */
export type AccountDeletionResult =
  | { ok: true }
  | { ok: false; reason: "has_submitted_applications" | "no_pending_request" | "not_found" | "not_configured" | "auth_delete_failed" | "error" };

const STORAGE_CHUNK = 100;

export async function deleteAccount(actorId: string, userId: string): Promise<AccountDeletionResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("svc_delete_account_data", { p_actor_id: actorId, p_user_id: userId });
  if (error) {
    const message = error.message ?? "";
    if (message.includes("has_submitted_applications")) return { ok: false, reason: "has_submitted_applications" };
    if (message.includes("no_pending_request")) return { ok: false, reason: "no_pending_request" };
    if (error.code === "P0002") return { ok: false, reason: "not_found" };
    logError("account.delete_data", error);
    // The function does not exist if database migration 20261015000300 has not been run.
    if (error.code === "PGRST202" || error.code === "42883") return { ok: false, reason: "not_configured" };
    return { ok: false, reason: "error" };
  }

  const paths = (Array.isArray(data) ? data : []).filter((p): p is string => typeof p === "string");
  for (let i = 0; i < paths.length; i += STORAGE_CHUNK) {
    const { error: removeError } = await admin.storage.from(STORAGE_BUCKET).remove(paths.slice(i, i + STORAGE_CHUNK));
    // The database record is deleted; a file left in storage becomes orphaned. It is logged and the deletion continues.
    if (removeError) logError("account.delete_storage", removeError, { count: paths.length });
  }

  const { error: authError } = await admin.auth.admin.deleteUser(userId);
  if (authError) {
    logError("account.delete_auth_user", authError);
    return { ok: false, reason: "auth_delete_failed" };
  }
  return { ok: true };
}
