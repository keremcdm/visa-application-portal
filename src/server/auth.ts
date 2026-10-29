import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { UserRole } from "@/lib/domain/constants";
import { ROUTES } from "@/lib/site";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { logError } from "./log";
import { ADMIN_REQUIRED_ERROR, FORBIDDEN_ERROR, MFA_REQUIRED_ERROR, SESSION_EXPIRED_ERROR } from "./result";

/**
 * AUTHENTICATION AND AUTHORIZATION (Data Access Layer)
 *
 * Every page, server action and route handler verifies permission HERE; visibility in the UI
 * or the redirect in proxy.ts never counts as a security boundary.
 * The role is read from the database on every request (the session cookie is not trusted).
 *
 * Two-factor authentication is mandatory for staff: staff permissions are only granted in a
 * session where the code was entered (`aal2`). The database applies the same rule (migration 15, private.is_staff).
 */
export type CurrentUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  isActive: boolean;
  /**
   * Is the staff member an admin: inviting staff, disabling/enabling access,
   * resetting two-factor authentication and granting admin rights are admin-only. The database applies the same rule.
   */
  isAdmin: boolean;
  /** Assurance level of the session: "aal2" is a session that passed two-factor authentication. */
  aal: "aal1" | "aal2";
};

/** Returns the signed-in user; null if none. Not queried again within the same render. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  // The session check never runs at build time (prerendered); it runs on every request.
  await connection();
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  // getClaims() verifies the token's signature and expiry (with Supabase's public keys; asks the Auth server if needed);
  // it never trusts cookie data without verification. Pages open faster because they don't call the Auth server
  // separately each time. Role and active state are still read from the database.
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims || typeof claims.sub !== "string") return null;

  const read = (columns: string) => supabase.from("profiles").select(columns).eq("id", claims.sub).maybeSingle<Record<string, unknown>>();
  let { data: profile, error: profileError } = await read("id, email, first_name, last_name, role, is_active, is_admin");
  // Without migration 18 there is no admin column; nobody counts as an admin, the session still opens.
  if (profileError?.code === "42703") ({ data: profile, error: profileError } = await read("id, email, first_name, last_name, role, is_active"));
  if (profileError) {
    logError("auth.load_profile", profileError);
    return null;
  }
  if (!profile) return null;

  return {
    id: profile.id as string,
    email: profile.email as string,
    firstName: profile.first_name as string,
    lastName: profile.last_name as string,
    role: profile.role === "staff" ? "staff" : "customer",
    isActive: profile.is_active === true,
    isAdmin: profile.role === "staff" && profile.is_admin === true,
    aal: claims.aal === "aal2" ? "aal2" : "aal1",
  };
});

/** Is it an active staff account? (With or without two-factor authentication; for redirects only.) */
export function isStaffAccount(user: CurrentUser | null): user is CurrentUser {
  return user !== null && user.role === "staff" && user.isActive;
}

/** Staff permission: an active staff account AND a session with two-factor authentication. */
export function isActiveStaff(user: CurrentUser | null): user is CurrentUser {
  return isStaffAccount(user) && user.aal === "aal2";
}

/** Permission error for staff actions; null if permitted. */
export function staffAccessError(user: CurrentUser | null): string | null {
  if (!user) return SESSION_EXPIRED_ERROR;
  if (isActiveStaff(user)) return null;
  return isStaffAccount(user) ? MFA_REQUIRED_ERROR : FORBIDDEN_ERROR;
}

/** Permission error for staff management actions (invite, access, authentication reset, admin rights); null if permitted. */
export function staffAdminError(user: CurrentUser | null): string | null {
  return staffAccessError(user) ?? (user?.isAdmin ? null : ADMIN_REQUIRED_ERROR);
}

/** For pages: redirects to the sign-in page if not signed in. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(ROUTES.login);
  return user;
}

/** For customer panel pages: staff are redirected to their own panel. */
export async function requireCustomer(): Promise<CurrentUser> {
  const user = await requireUser();
  if (isStaffAccount(user)) redirect(ROUTES.staff);
  return user;
}

/**
 * For admin panel pages: a non-staff user is redirected to the customer panel, staff without two-factor
 * authentication to the verification page.
 */
export async function requireStaff(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!isStaffAccount(user)) redirect(ROUTES.customer);
  if (user.aal !== "aal2") redirect(ROUTES.staffMfa);
  return user;
}
