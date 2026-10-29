"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { generateRecoveryCode, hashRecoveryCode, isRecoveryCodeFormat, normalizeRecoveryCode } from "@/features/auth/recovery-code";
import { ROUTES } from "@/lib/site";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isActiveStaff, isStaffAccount, staffAccessError, staffAdminError } from "../auth";
import { logError } from "../log";
import { fail, FORBIDDEN_ERROR, GENERIC_ERROR, isUuid, NOT_CONFIGURED_ERROR, NOT_FOUND_ERROR, ok, SESSION_EXPIRED_ERROR, type ActionResult } from "../result";

/**
 * TWO-FACTOR AUTHENTICATION FOR STAFF
 *
 * A 6-digit code (TOTP) from an authenticator app (Google Authenticator, Microsoft Authenticator …). Supabase Auth's own
 * MFA feature is used; the secret and codes are verified by Supabase and never stored in the app. A session where the code
 * was entered becomes "aal2"; staff permissions are only granted in such a session (src/server/auth.ts and database migration 15).
 */

export type EnrollmentInfo = { factorId: string; qrCode: string; secret: string };

async function staffAccount(): Promise<{ supabase: SupabaseClient } | { error: string }> {
  if (!isSupabaseConfigured()) return { error: NOT_CONFIGURED_ERROR };
  const user = await getCurrentUser();
  if (!user) return { error: SESSION_EXPIRED_ERROR };
  if (!isStaffAccount(user)) return { error: FORBIDDEN_ERROR };
  return { supabase: await createClient() };
}

/** Starts setup: deletes unfinished setups and creates a new authenticator app factor (QR code + key). */
export async function startMfaEnrollmentAction(): Promise<ActionResult<EnrollmentInfo>> {
  const ctx = await staffAccount();
  if ("error" in ctx) return fail(ctx.error);
  const { supabase } = ctx;

  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) {
    logError("mfa.enroll.list", listError);
    return fail(GENERIC_ERROR);
  }
  if (factors.totp.length > 0) return fail("Doğrulama uygulamanız zaten kurulu. Sayfayı yenileyip uygulamadaki kodu giriniz.");
  for (const factor of factors.all) {
    if (factor.factor_type !== "totp" || factor.status === "verified") continue;
    const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (error) logError("mfa.enroll.cleanup", error);
  }

  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Yönetim Paneli", issuer: "Vize Başvuru Portalı" });
  if (error || !data) {
    if (error) logError("mfa.enroll", error, { code: String(error.code ?? "") });
    return fail(
      `Doğrulama uygulaması kaydı oluşturulamadı. Supabase panelinde iki adımlı doğrulamanın (TOTP) açık olduğunu kontrol ediniz.${error?.code ? ` (Hata kodu: ${error.code})` : ""}`,
    );
  }
  return { ok: true, data: { factorId: data.id, qrCode: safeSvgDataUri(data.totp.qr_code), secret: data.totp.secret } };
}

/**
 * Supabase returns the QR code as "data:image/svg+xml;utf-8,<svg …>", an unencoded SVG. If the SVG contains "#" (a color code)
 * browsers cut the address there and the QR code looks broken; so the SVG is encoded again.
 */
function safeSvgDataUri(value: string): string {
  const comma = value.indexOf(",");
  const svg = comma >= 0 && value.startsWith("data:") ? value.slice(comma + 1) : value;
  const decoded = /%[0-9a-f]{2}/i.test(svg) ? safeDecode(svg) : svg;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(decoded)}`;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export type MfaFormState = { status: "idle" } | { status: "error"; message: string };

/**
 * Verifies the 6-digit code from the authenticator app (form action). During setup the new factor's id comes from the form
 * and it is checked to be the user's own unverified factor; at sign-in the user's verified factor is used.
 * On success the session becomes "aal2" and goes to the admin panel.
 */
export async function verifyMfaAction(_previous: MfaFormState, formData: FormData): Promise<MfaFormState> {
  const ctx = await staffAccount();
  if ("error" in ctx) return { status: "error", message: ctx.error };
  const { supabase } = ctx;

  const code = String(formData.get("code") ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) return { status: "error", message: "Doğrulama uygulamasındaki 6 haneli kodu yazınız." };
  const requested = formData.get("factorId");

  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) {
    logError("mfa.verify.list", listError);
    return { status: "error", message: GENERIC_ERROR };
  }
  const factor =
    typeof requested === "string" && requested !== ""
      ? factors.all.find((f) => f.id === requested && f.factor_type === "totp")
      : factors.totp[0];
  if (!factor) return { status: "error", message: "Doğrulama uygulaması kaydı bulunamadı. Sayfayı yenileyip yeniden deneyiniz." };

  let { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  // Supabase requires the requests that challenge and verify the code to come from the same IP address; if the server's
  // connection changed between the two requests (e.g. IPv4/IPv6) it is tried once more. The code is still valid because it has not been used yet.
  if (error && (error.code === "mfa_ip_address_mismatch" || error.code === "mfa_challenge_expired")) {
    ({ error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code }));
  }
  if (error) {
    // Only the error code and status are logged (never the entered code).
    logError("mfa.verify", error, { code: String(error.code ?? ""), enrolling: factor.status !== "verified" });
    return { status: "error", message: verifyErrorMessage(error.code, error.status) };
  }
  // Once setup is finished a recovery code is created first; at every later sign-in it goes straight to the panel.
  redirect(factor.status === "verified" ? ROUTES.staff : ROUTES.staffMfaRecoveryCode);
}

/** Explanation shown to the user for a Supabase verification error (error code at the end so it is easy to report). */
function verifyErrorMessage(code: string | undefined, status: number | undefined): string {
  const suffix = code ? ` (Hata kodu: ${code})` : status ? ` (Hata kodu: ${status})` : "";
  switch (code) {
    case "mfa_verification_failed":
    case "mfa_verification_rejected":
      return `Kod yanlış. Uygulamadaki güncel kodu yazınız (kod 30 saniyede bir değişir). Uygulamada bu hesap için birden çok "Vize Başvuru Portalı" satırı varsa en son eklediğinizi kullanınız; telefonunuzun saati otomatik ayarlı olmalıdır.${suffix}`;
    case "mfa_factor_not_found":
      return `Doğrulama uygulaması kaydı bulunamadı. Sayfayı yenileyip "Karekodu göster" ile kurulumu yeniden başlatınız ve yeni karekodu okutunuz.${suffix}`;
    case "mfa_totp_verify_not_enabled":
    case "mfa_totp_enroll_not_enabled":
      return `Supabase panelinde iki adımlı doğrulama (TOTP) kapalı görünüyor. Authentication → Multi-Factor bölümünde "TOTP"nin hem kayıt hem doğrulama için açık olduğunu kontrol ediniz.${suffix}`;
    case "mfa_ip_address_mismatch":
    case "mfa_challenge_expired":
      return `Doğrulama tamamlanamadı; birkaç saniye sonra uygulamadaki yeni kodla tekrar deneyiniz.${suffix}`;
    case "over_request_rate_limit":
      return `Çok fazla deneme yapıldı. Birkaç dakika bekleyip tekrar deneyiniz.${suffix}`;
    case "session_not_found":
    case "insufficient_aal":
      return `Oturumunuz yenilenmeli. Çıkış yapıp yeniden giriş yapınız.${suffix}`;
    default:
      return status === 429
        ? `Çok fazla deneme yapıldı. Birkaç dakika bekleyip tekrar deneyiniz.${suffix}`
        : `Kod doğrulanamadı. Lütfen tekrar deneyiniz; sorun sürerse ekrandaki hata kodunu bildiriniz.${suffix}`;
  }
}

/**
 * Resets another consultant's two-factor authentication (if they lost their phone). The person sets up the authenticator
 * app again at next sign-in. You cannot reset your own authentication here; it is written to the audit log.
 */
export async function resetStaffMfaAction(userId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!isActiveStaff(user)) return fail(staffAccessError(user) ?? FORBIDDEN_ERROR);
  // Resetting authentication is admin-only.
  const adminError = staffAdminError(user);
  if (adminError) return fail(adminError);
  if (!isAdminClientConfigured()) return fail(NOT_CONFIGURED_ERROR);
  if (!isUuid(userId)) return fail(NOT_FOUND_ERROR);
  if (userId === user.id) return fail("Kendi iki adımlı doğrulamanızı sıfırlayamazsınız; başka bir danışmandan isteyiniz.");

  const supabase = await createClient();
  const { data: target, error: readError } = await supabase.from("profiles").select("id, role").eq("id", userId).maybeSingle();
  if (readError) {
    logError("mfa.reset.read", readError);
    return fail(GENERIC_ERROR);
  }
  if (!target || target.role !== "staff") return fail(NOT_FOUND_ERROR);

  // The staff member's identity and permission were verified above; the Auth admin API requires the service role.
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
  if (error) {
    logError("mfa.reset.list", error);
    return fail(GENERIC_ERROR);
  }
  for (const factor of data.factors) {
    const { error: deleteError } = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
    if (deleteError) {
      logError("mfa.reset.delete", deleteError);
      return fail(GENERIC_ERROR);
    }
  }
  const { error: auditError } = await admin.rpc("svc_record_staff_security_event", {
    p_actor_id: user.id,
    p_action: "staff.mfa_reset",
    p_target_id: userId,
  });
  if (auditError) logError("mfa.reset.audit", auditError);
  revalidatePath(ROUTES.staffSettings, "layout");
  return ok(
    data.factors.length > 0
      ? "İki adımlı doğrulama sıfırlandı. Kişi bir sonraki girişinde doğrulama uygulamasını yeniden kuracak."
      : "Bu kişinin kurulu bir doğrulama uygulaması yoktu; bir sonraki girişinde kuracak.",
  );
}

// --- Recovery code ----------------------------------

const RECOVERY_NOT_READY = "Yedek kod için veritabanı güncellemesi (23. dosya) henüz çalıştırılmadı. Lütfen yöneticinize haber veriniz.";

/**
 * Creates or renews the recovery code; the old code becomes invalid. The code is returned only once in this response and
 * never stored anywhere (only its digest stays in the database). Requires a staff session with two-factor authentication.
 */
export async function createRecoveryCodeAction(): Promise<ActionResult<{ code: string }>> {
  const user = await getCurrentUser();
  if (!isActiveStaff(user)) return fail(staffAccessError(user) ?? FORBIDDEN_ERROR);
  if (!isAdminClientConfigured()) return fail(NOT_CONFIGURED_ERROR);

  const code = generateRecoveryCode();
  // Identity and permission were verified above; the recovery code table is only written with the service role.
  const { error } = await createAdminClient().rpc("svc_set_staff_recovery_code", {
    p_user_id: user.id,
    p_code_hash: hashRecoveryCode(normalizeRecoveryCode(code)),
  });
  if (error) {
    if (error.code === "PGRST202") return fail(RECOVERY_NOT_READY);
    logError("mfa.recovery_code.create", error);
    return fail(GENERIC_ERROR);
  }
  revalidatePath(ROUTES.staff, "layout");
  return ok(undefined, { code });
}

/**
 * A staff member who cannot access their authenticator app types their recovery code after signing in with their password
 * (form action). If the code is correct it is consumed (deleted), the authenticator factor is removed and the person sets it
 * up again. After 5 wrong attempts in a row they must wait 15 minutes (enforced by the database). The entered code is never logged or audited.
 */
export async function redeemRecoveryCodeAction(_previous: MfaFormState, formData: FormData): Promise<MfaFormState> {
  if (!isSupabaseConfigured() || !isAdminClientConfigured()) return { status: "error", message: NOT_CONFIGURED_ERROR };
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: SESSION_EXPIRED_ERROR };
  if (!isStaffAccount(user)) return { status: "error", message: FORBIDDEN_ERROR };

  const normalized = normalizeRecoveryCode(formData.get("recoveryCode"));
  if (!isRecoveryCodeFormat(normalized)) {
    return { status: "error", message: "Yedek kod 20 karakterdir (ör. K7Q4-9MZD-X2PH-RT6W-8BNC). Kaydettiğiniz kodu kontrol edip yeniden yazınız." };
  }

  // Identity was verified above. The factors are read before the code is consumed: if they cannot be read the code is not wasted.
  const admin = createAdminClient();
  const { data: listed, error: listError } = await admin.auth.admin.mfa.listFactors({ userId: user.id });
  if (listError) {
    logError("mfa.recovery.list", listError);
    return { status: "error", message: GENERIC_ERROR };
  }

  const { data: accepted, error } = await admin.rpc("svc_use_staff_recovery_code", { p_user_id: user.id, p_code_hash: hashRecoveryCode(normalized) });
  if (error) {
    if (error.message?.includes("too_many_attempts")) return { status: "error", message: "Çok fazla yanlış deneme yapıldı. 15 dakika bekleyip tekrar deneyiniz." };
    if (error.code === "PGRST202") return { status: "error", message: RECOVERY_NOT_READY };
    logError("mfa.recovery.use", error);
    return { status: "error", message: GENERIC_ERROR };
  }
  if (accepted !== true) {
    return { status: "error", message: "Yedek kod yanlış. Kaydettiğiniz kodu kontrol edip yeniden yazınız; büyük-küçük harf ve tireler fark etmez." };
  }

  for (const factor of listed.factors) {
    const { error: deleteError } = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId: user.id });
    if (deleteError) {
      logError("mfa.recovery.delete", deleteError);
      return {
        status: "error",
        message: "Yedek kodunuz kullanıldı ancak doğrulama uygulaması kaydı kaldırılamadı. Bir yöneticiden Ayarlar → Personel bölümünden iki adımlı doğrulamanızı sıfırlamasını isteyiniz.",
      };
    }
  }
  redirect(ROUTES.staffMfa);
}
