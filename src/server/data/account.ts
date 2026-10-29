import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireCustomer, requireStaff } from "../auth";
import { logError } from "../log";
import { DataError } from "./queries";

type Row = Record<string, unknown>;

/** The deletion requests table comes with database migration 20261015000300; without it the feature is off. */
const isMissingTable = (error: { code?: string } | null) => error?.code === "42P01" || error?.code === "PGRST205";

export type AccountDeletionState = {
  /** Does the deletion requests table exist (has the database update been applied)? */
  available: boolean;
  /** Is there a submitted (non-draft) application? If so the account cannot be deleted directly; a request is sent. */
  hasSubmitted: boolean;
  pendingSince: string | null;
  lastRejection: { at: string; note: string } | null;
};

/** For the My Account → "Hesabı sil" section. Read with the user's own session (RLS). */
export async function loadAccountDeletionState(): Promise<AccountDeletionState> {
  const user = await requireCustomer();
  const supabase = await createClient();
  const [applications, requests] = await Promise.all([
    supabase.from("applications").select("status").eq("customer_id", user.id),
    supabase
      .from("account_deletion_requests")
      .select("status, staff_note, created_at, handled_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  if (applications.error) {
    logError("data.account.applications", applications.error);
    throw new DataError("account_applications");
  }
  const hasSubmitted = (applications.data as Row[]).some((a) => a.status !== "draft");
  if (requests.error) {
    if (isMissingTable(requests.error)) return { available: false, hasSubmitted, pendingSince: null, lastRejection: null };
    logError("data.account.deletion_requests", requests.error);
    throw new DataError("account_deletion_requests");
  }
  const rows = requests.data as Row[];
  const pending = rows.find((r) => r.status === "pending");
  const rejected = rows.find((r) => r.status === "rejected");
  return {
    available: true,
    hasSubmitted,
    pendingSince: pending ? String(pending.created_at) : null,
    lastRejection: !pending && rejected ? { at: String(rejected.handled_at ?? rejected.created_at), note: String(rejected.staff_note ?? "") } : null,
  };
}

export type PendingDeletionRequest = {
  id: string;
  createdAt: string;
  customerName: string;
  customerEmail: string;
  submittedCount: number;
  draftCount: number;
};

/** Admin → pending account deletion requests. With the staff member's own session (RLS). Empty list if the table does not exist. */
export async function loadPendingDeletionRequests(): Promise<PendingDeletionRequest[]> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("account_deletion_requests")
    .select("id, user_id, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) {
    if (isMissingTable(error)) return [];
    logError("data.staff.deletion_requests", error);
    throw new DataError("deletion_requests");
  }
  const requests = data as Row[];
  if (requests.length === 0) return [];
  const userIds = requests.map((r) => String(r.user_id));
  // Two separate queries: the table has two links to profiles (requester and the staff member who acted), so a nested read is ambiguous.
  const [profiles, applications] = await Promise.all([
    supabase.from("profiles").select("id, first_name, last_name, email").in("id", userIds),
    supabase.from("applications").select("customer_id, status").in("customer_id", userIds),
  ]);
  if (profiles.error || applications.error) {
    logError("data.staff.deletion_request_details", profiles.error ?? applications.error);
    throw new DataError("deletion_request_details");
  }
  const profileById = new Map((profiles.data as Row[]).map((p) => [String(p.id), p]));
  return requests.map((r) => {
    const userId = String(r.user_id);
    const profile = profileById.get(userId);
    const apps = (applications.data as Row[]).filter((a) => a.customer_id === userId);
    const name = `${String(profile?.first_name ?? "")} ${String(profile?.last_name ?? "")}`.trim();
    return {
      id: String(r.id),
      createdAt: String(r.created_at),
      customerName: name || "—",
      customerEmail: String(profile?.email ?? ""),
      submittedCount: apps.filter((a) => a.status !== "draft").length,
      draftCount: apps.filter((a) => a.status === "draft").length,
    };
  });
}
