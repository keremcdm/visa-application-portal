"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/site";
import { isAdminClientConfigured } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { LAST_EMAIL_COOKIE, REMEMBER_COOKIE } from "@/lib/supabase/session-cookies";
import { deleteAccount, type AccountDeletionResult } from "../account-deletion";
import { getCurrentUser, isActiveStaff, staffAccessError } from "../auth";
import { scheduleEmailDelivery } from "../email/deliver";
import { logError } from "../log";
import { fail, FORBIDDEN_ERROR, GENERIC_ERROR, isUuid, NOT_CONFIGURED_ERROR, NOT_FOUND_ERROR, ok, SESSION_EXPIRED_ERROR, type ActionResult } from "../result";

/*
 * ACCOUNT DELETION
 *   - Customer without a submitted application: the account, drafts and uploaded documents are deleted immediately.
 *   - Customer with a submitted application: a deletion request reaches the company; staff delete the account or refuse with a reason.
 */

const MIGRATION_MISSING = "Hesap silme henüz etkin değil (veritabanı güncellemesi bekleniyor). Hiçbir şey silinmedi.";

function deletionFailure(result: Exclude<AccountDeletionResult, { ok: true }>): ActionResult {
  switch (result.reason) {
    case "has_submitted_applications":
      return fail("Gönderilmiş başvurunuz olduğu için hesabınız doğrudan silinemez. Bunun yerine silme talebi gönderebilirsiniz.");
    case "no_pending_request":
      return fail("Bu müşterinin bekleyen bir silme talebi yok; hesap silinmedi.");
    case "not_found":
      return fail(NOT_FOUND_ERROR);
    case "not_configured":
      return fail(MIGRATION_MISSING);
    case "auth_delete_failed":
      return fail("Başvuru verileri silindi ancak hesap silinemedi. Lütfen tekrar deneyiniz.");
    default:
      return fail(GENERIC_ERROR);
  }
}

/** The customer deletes their own account (only without a submitted application; the database checks too). */
export async function deleteMyAccountAction(): Promise<ActionResult> {
  if (!isSupabaseConfigured() || !isAdminClientConfigured()) return fail(NOT_CONFIGURED_ERROR);
  const user = await getCurrentUser();
  if (!user) return fail(SESSION_EXPIRED_ERROR);
  if (user.role !== "customer") return fail(FORBIDDEN_ERROR);

  const result = await deleteAccount(user.id, user.id);
  if (!result.ok) return deletionFailure(result);

  // The account no longer exists: the session cookies and remembered e-mail in this browser are deleted.
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) logError("account.sign_out_after_delete", error);
  const jar = await cookies();
  jar.delete(REMEMBER_COOKIE);
  jar.delete(LAST_EMAIL_COOKIE);
  redirect(`${ROUTES.login}?status=account-deleted`);
}

/** A customer with a submitted application sends the company a deletion request (with their own session; RLS only allows it in their own name). */
export async function requestAccountDeletionAction(): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return fail(NOT_CONFIGURED_ERROR);
  const user = await getCurrentUser();
  if (!user) return fail(SESSION_EXPIRED_ERROR);
  if (user.role !== "customer") return fail(FORBIDDEN_ERROR);

  const supabase = await createClient();
  const { error } = await supabase.from("account_deletion_requests").insert({ user_id: user.id });
  if (error) {
    if (error.code === "23505") return fail("Silme talebiniz zaten alındı; şirketimiz inceliyor.");
    logError("account.request_deletion", error);
    if (error.code === "42P01" || error.code === "PGRST205") return fail("Silme talebi henüz etkin değil (veritabanı güncellemesi bekleniyor). Talep gönderilmedi.");
    return fail(GENERIC_ERROR);
  }
  revalidatePath(ROUTES.customerAccount);
  revalidatePath(ROUTES.staff);
  return ok("Silme talebiniz alındı. Şirketimiz talebinizi inceleyip size bilgi verecek.");
}

type StaffCheck = { error: string } | { staffId: string };

async function requireStaffAction(): Promise<StaffCheck> {
  if (!isSupabaseConfigured()) return { error: NOT_CONFIGURED_ERROR };
  const user = await getCurrentUser();
  if (!user) return { error: SESSION_EXPIRED_ERROR };
  if (!isActiveStaff(user)) return { error: staffAccessError(user) ?? FORBIDDEN_ERROR };
  return { staffId: user.id };
}

async function pendingRequest(requestId: string): Promise<{ id: string; userId: string } | null> {
  const supabase = await createClient();
  // The staff member's own session; RLS lets staff read all requests.
  const { data, error } = await supabase.from("account_deletion_requests").select("id, user_id").eq("id", requestId).eq("status", "pending").maybeSingle();
  if (error) {
    logError("account.load_request", error);
    return null;
  }
  return data ? { id: String(data.id), userId: String(data.user_id) } : null;
}

/** Staff approve the pending request and permanently delete the customer's account and ALL their applications. */
export async function approveAccountDeletionAction(requestId: string): Promise<ActionResult> {
  const staff = await requireStaffAction();
  if ("error" in staff) return fail(staff.error);
  if (!isAdminClientConfigured()) return fail(NOT_CONFIGURED_ERROR);
  if (!isUuid(requestId)) return fail(NOT_FOUND_ERROR);
  const request = await pendingRequest(requestId);
  if (!request) return fail("Bu talep bulunamadı veya daha önce sonuçlandırıldı.");

  const result = await deleteAccount(staff.staffId, request.userId);
  if (!result.ok) return deletionFailure(result);
  revalidatePath(ROUTES.staff);
  return ok("Müşterinin hesabı, başvuruları ve belgeleri silindi.");
}

/** Staff refuse the request with a reason; the customer is notified and sees the reason on the My Account page. */
export async function rejectAccountDeletionAction(requestId: string, note: unknown): Promise<ActionResult> {
  const staff = await requireStaffAction();
  if ("error" in staff) return fail(staff.error);
  if (!isUuid(requestId)) return fail(NOT_FOUND_ERROR);
  const text = typeof note === "string" ? note.trim().slice(0, 1000) : "";
  if (text === "") return fail("Reddetme gerekçesini yazınız; müşteri bu açıklamayı görür.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("account_deletion_requests")
    .update({ status: "rejected", staff_note: text, handled_by: staff.staffId, handled_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("user_id");
  if (error) {
    logError("account.reject_request", error);
    return fail(GENERIC_ERROR);
  }
  const row = data?.[0] as { user_id?: string } | undefined;
  if (!row?.user_id) return fail("Bu talep bulunamadı veya daha önce sonuçlandırıldı.");

  const { error: notifyError } = await supabase.from("notifications").insert({
    user_id: row.user_id,
    kind: "account.deletion_rejected",
    title: "Hesap silme talebiniz reddedildi",
    body: text,
  });
  if (notifyError) logError("notification.create", notifyError);
  else scheduleEmailDelivery();
  revalidatePath(ROUTES.staff);
  return ok(notifyError ? "Talep reddedildi. Ancak müşteriye bildirim oluşturulamadı; lütfen müşteriyi ayrıca bilgilendiriniz." : "Talep reddedildi; müşteri bilgilendirildi.");
}
