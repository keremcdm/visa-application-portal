"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ROUTES } from "@/lib/site";
import { CAPTCHA_FAILED_MESSAGE, CAPTCHA_FIELD, parseCaptchaToken } from "@/features/auth/captcha";
import { emailSchema, passwordSchema } from "@/features/auth/schemas";
import { getSiteUrl, isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { isValidIsoDate, parseDateInput, todayInIstanbul } from "@/lib/validation/formats";
import { getCurrentUser } from "../auth";
import { verifyCurrentPassword } from "../password-check";
import { logError } from "../log";
import { GENERIC_ERROR, NOT_CONFIGURED_ERROR, SESSION_EXPIRED_ERROR } from "../result";

export type ProfileFormState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors?: Record<string, string>; values: Record<string, string> }
  | { status: "success"; message: string };

const profileSchema = z.object({
  firstName: z.string().trim().min(1, "Adınızı giriniz.").max(80, "Ad en fazla 80 karakter olabilir."),
  lastName: z.string().trim().min(1, "Soyadınızı giriniz.").max(80, "Soyad en fazla 80 karakter olabilir."),
  // The date field submits "GG.AA.YYYY"; "YYYY-MM-DD" can also arrive when the page is not interactive.
  birthDate: z
    .string()
    .transform((v) => parseDateInput(v) ?? "")
    .refine(isValidIsoDate, "Doğum tarihinizi GG.AA.YYYY biçiminde giriniz.")
    .refine((v) => v >= "1900-01-01", "Geçerli bir doğum tarihi giriniz.")
    .refine((v) => v <= todayInIstanbul(), "Doğum tarihi bugünden ileri olamaz."),
});

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * "Hesabım" (My Account) page: the user corrects their own first name, last name and date of birth.
 * The write uses the user's own session; the database only allows these three columns and only their own row.
 * The details in the application form are not affected.
 */
export async function updateProfileAction(_prev: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const values = { firstName: text(formData, "firstName"), lastName: text(formData, "lastName"), birthDate: text(formData, "birthDate") };
  if (!isSupabaseConfigured()) return { status: "error", message: NOT_CONFIGURED_ERROR, values };
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: SESSION_EXPIRED_ERROR, values };

  const parsed = profileSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!(key in fieldErrors)) fieldErrors[key] = issue.message;
    }
    return { status: "error", message: "Lütfen işaretli alanları kontrol ediniz. Bilgileriniz kaydedilmedi.", fieldErrors, values };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ first_name: parsed.data.firstName, last_name: parsed.data.lastName, birth_date: parsed.data.birthDate })
    .eq("id", user.id)
    .select("id");
  if (error) {
    logError("profile.update", error);
    return { status: "error", message: GENERIC_ERROR, values };
  }
  // If the database update (migration 8) has not been applied no row is returned; it is never shown as saved.
  if (!data || data.length === 0) {
    logError("profile.update", new Error("Profil güncellenemedi: satır döndürülmedi (izin veya politika eksik olabilir)."));
    return { status: "error", message: GENERIC_ERROR, values };
  }

  revalidatePath(ROUTES.customer, "layout");
  return { status: "success", message: "Bilgileriniz kaydedildi." };
}

// --- E-mail and password ----------------------------------
// The customer changes these themselves without writing to the company. Both actions first verify the CURRENT PASSWORD.
// Passwords are never sent back to the form and never logged.

export type CredentialFormState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors?: Record<string, string>; values?: Record<string, string> }
  | { status: "success"; message: string };

const WRONG_PASSWORD = "Mevcut şifreniz hatalı.";
const RATE_LIMITED = "Çok fazla deneme yapıldı. Lütfen birkaç dakika sonra tekrar deneyiniz.";

/** Sends a confirmation link to the new e-mail address (and, depending on the Supabase setting, to the old one); the address changes once confirmed. */
export async function changeEmailAction(_prev: CredentialFormState, formData: FormData): Promise<CredentialFormState> {
  const values = { newEmail: text(formData, "newEmail") };
  if (!isSupabaseConfigured()) return { status: "error", message: NOT_CONFIGURED_ERROR, values };
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: SESSION_EXPIRED_ERROR, values };

  const email = emailSchema.safeParse(values.newEmail);
  if (!email.success) {
    const message = email.error.issues[0]?.message ?? "Geçerli bir e-posta adresi giriniz.";
    return { status: "error", message, fieldErrors: { newEmail: message }, values };
  }
  if (email.data === user.email.toLowerCase()) {
    return { status: "error", message: "Yeni e-posta adresi şu anki adresinizle aynı.", fieldErrors: { newEmail: "Farklı bir adres yazınız." }, values };
  }
  const currentPassword = text(formData, "currentPassword");
  if (currentPassword === "") {
    return { status: "error", message: "Mevcut şifrenizi yazınız.", fieldErrors: { currentPassword: "Mevcut şifrenizi yazınız." }, values };
  }
  const check = await verifyCurrentPassword(user.email, currentPassword, parseCaptchaToken(formData.get(CAPTCHA_FIELD)));
  if (check === "wrong") return { status: "error", message: WRONG_PASSWORD, fieldErrors: { currentPassword: WRONG_PASSWORD }, values };
  if (check === "rate_limited") return { status: "error", message: RATE_LIMITED, values };
  if (check === "captcha") return { status: "error", message: CAPTCHA_FAILED_MESSAGE, values };
  if (check === "error") return { status: "error", message: GENERIC_ERROR, values };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser(
    { email: email.data },
    { emailRedirectTo: `${getSiteUrl()}/auth/confirm?next=${encodeURIComponent(`${ROUTES.customerAccount}?status=email-changed`)}` },
  );
  if (error) {
    // Whether the address is registered to another account is not revealed.
    if (error.code === "email_exists" || error.code === "user_already_exists") {
      return { status: "error", message: "Bu e-posta adresi kullanılamıyor. Lütfen başka bir adres yazınız.", fieldErrors: { newEmail: "Başka bir adres yazınız." }, values };
    }
    if (error.code === "over_email_send_rate_limit" || error.status === 429) return { status: "error", message: RATE_LIMITED, values };
    logError("profile.change_email", { code: error.code, status: error.status });
    return { status: "error", message: GENERIC_ERROR, values };
  }
  revalidatePath(ROUTES.customerAccount);
  return {
    status: "success",
    message:
      "Doğrulama bağlantısı gönderildi. Değişikliği tamamlamak için yeni adresinize gelen bağlantıya tıklayınız; mevcut adresinize de bir onay bağlantısı geldiyse onu da onaylayınız. Onaylayana kadar mevcut adresinizle giriş yaparsınız.",
  };
}

export async function changePasswordAction(_prev: CredentialFormState, formData: FormData): Promise<CredentialFormState> {
  if (!isSupabaseConfigured()) return { status: "error", message: NOT_CONFIGURED_ERROR };
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: SESSION_EXPIRED_ERROR };

  const currentPassword = text(formData, "currentPassword");
  const newPassword = text(formData, "newPassword");
  const fieldErrors: Record<string, string> = {};
  if (currentPassword === "") fieldErrors.currentPassword = "Mevcut şifrenizi yazınız.";
  const parsed = passwordSchema.safeParse(newPassword);
  if (!parsed.success) fieldErrors.newPassword = parsed.error.issues[0]?.message ?? "Geçersiz şifre.";
  else if (newPassword !== text(formData, "newPasswordConfirm")) fieldErrors.newPasswordConfirm = "Şifreler birbiriyle aynı olmalıdır.";
  if (Object.keys(fieldErrors).length > 0) return { status: "error", message: "Lütfen işaretli alanları kontrol ediniz. Şifreniz değiştirilmedi.", fieldErrors };
  if (newPassword === currentPassword) {
    return { status: "error", message: "Yeni şifreniz mevcut şifrenizle aynı olamaz.", fieldErrors: { newPassword: "Farklı bir şifre seçiniz." } };
  }

  const check = await verifyCurrentPassword(user.email, currentPassword, parseCaptchaToken(formData.get(CAPTCHA_FIELD)));
  if (check === "wrong") return { status: "error", message: WRONG_PASSWORD, fieldErrors: { currentPassword: WRONG_PASSWORD } };
  if (check === "rate_limited") return { status: "error", message: RATE_LIMITED };
  if (check === "captcha") return { status: "error", message: CAPTCHA_FAILED_MESSAGE };
  if (check === "error") return { status: "error", message: GENERIC_ERROR };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: newPassword, current_password: currentPassword });
  if (error) {
    if (error.code === "same_password") return { status: "error", message: "Yeni şifreniz mevcut şifrenizle aynı olamaz.", fieldErrors: { newPassword: "Farklı bir şifre seçiniz." } };
    if (error.code === "weak_password") return { status: "error", message: "Şifreniz yeterince güçlü değil.", fieldErrors: { newPassword: "Daha güçlü bir şifre seçiniz." } };
    if (error.code === "reauthentication_needed") {
      return { status: "error", message: "Güvenlik nedeniyle şifre değişikliği için yeniden giriş yapmanız gerekiyor. Çıkış yapıp yeniden giriş yaptıktan sonra tekrar deneyiniz." };
    }
    logError("profile.change_password", { code: error.code, status: error.status });
    return { status: "error", message: GENERIC_ERROR };
  }
  return { status: "success", message: "Şifreniz değiştirildi. Bir sonraki girişinizde yeni şifrenizi kullanınız." };
}
