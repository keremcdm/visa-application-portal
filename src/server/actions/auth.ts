"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ROUTES, safeInternalPath } from "@/lib/site";
import { getSiteUrl, isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { LAST_EMAIL_COOKIE, LAST_EMAIL_MAX_AGE_SECONDS, REMEMBER_COOKIE, REMEMBER_MAX_AGE_SECONDS } from "@/lib/supabase/session-cookies";
import { CAPTCHA_FAILED_MESSAGE, CAPTCHA_FIELD, isCaptchaError, parseCaptchaToken } from "@/features/auth/captcha";
import { emailSchema, passwordSchema } from "@/features/auth/schemas";
import { isValidIsoDate, parseDateInput, todayInIstanbul } from "@/lib/validation/formats";
import { logError } from "../log";
import { GENERIC_ERROR, NOT_CONFIGURED_ERROR } from "../result";

export type AuthFormState =
  | { status: "idle" }
  /** `code: "account_exists"`: an account with this e-mail already exists at sign-up (the form shows sign-in and password reset links). */
  | { status: "error"; message: string; fieldErrors?: Record<string, string>; values?: Record<string, string>; code?: "account_exists" }
  /** `email`: for "Bağlantıyı tekrar gönder" (resend link) at sign-up and password reset (the address the user typed). */
  | { status: "success"; message: string; email?: string };

const RATE_LIMITED = "Çok fazla deneme yapıldı. Lütfen birkaç dakika sonra tekrar deneyiniz.";
const ACCOUNT_EXISTS = "Bu e-posta adresiyle zaten bir hesap var.";


const signUpSchema = z
  .object({
    firstName: z.string().trim().min(1, "Adınızı giriniz.").max(80, "Ad çok uzun."),
    lastName: z.string().trim().min(1, "Soyadınızı giriniz.").max(80, "Soyad çok uzun."),
    email: emailSchema,
    // The date field submits "GG.AA.YYYY"; "YYYY-MM-DD" can also arrive when the page is not interactive.
    birthDate: z
      .string()
      .transform((v) => parseDateInput(v) ?? "")
      .refine(isValidIsoDate, "Doğum tarihinizi GG.AA.YYYY biçiminde giriniz.")
      .refine((v) => v <= todayInIstanbul(), "Doğum tarihi bugünden ileri olamaz."),
    password: passwordSchema,
    passwordConfirm: z.string(),
    consent: z.literal("on", { error: "Devam etmek için KVKK Aydınlatma Metni’ni okuduğunuzu işaretleyiniz." }),
  })
  .refine((v) => v.password === v.passwordConfirm, { path: ["passwordConfirm"], message: "Şifreler birbiriyle aynı olmalıdır." });

function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function signUpAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  // Values other than passwords are sent back to refill the form on error.
  const values = {
    firstName: text(formData, "firstName"),
    lastName: text(formData, "lastName"),
    email: text(formData, "email"),
    birthDate: text(formData, "birthDate"),
  };
  if (!isSupabaseConfigured()) return { status: "error", message: NOT_CONFIGURED_ERROR, values };

  const parsed = signUpSchema.safeParse({
    ...values,
    password: text(formData, "password"),
    passwordConfirm: text(formData, "passwordConfirm"),
    consent: text(formData, "consent"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Lütfen işaretli alanları kontrol ediniz.", fieldErrors: fieldErrorsOf(parsed.error), values };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      captchaToken: parseCaptchaToken(formData.get(CAPTCHA_FIELD)),
      // The role is NOT READ from this metadata; a database trigger makes every new user a 'customer'.
      data: {
        first_name: parsed.data.firstName,
        last_name: parsed.data.lastName,
        birth_date: parsed.data.birthDate,
        consents_accepted: true,
      },
      emailRedirectTo: `${getSiteUrl()}/auth/confirm?next=${encodeURIComponent(ROUTES.customer)}`,
    },
  });

  if (error) {
    if (isCaptchaError(error)) return { status: "error", message: CAPTCHA_FAILED_MESSAGE, values };
    if (error.code === "weak_password") {
      return { status: "error", message: "Şifreniz yeterince güçlü değil. Lütfen daha güçlü bir şifre seçiniz.", fieldErrors: { password: "Daha güçlü bir şifre seçiniz." }, values };
    }
    if (error.code === "over_email_send_rate_limit" || error.status === 429) {
      return { status: "error", message: RATE_LIMITED, values };
    }
    if (error.code === "user_already_exists" || error.code === "email_exists") return accountExists(values);
    logError("auth.sign_up", error);
    return { status: "error", message: GENERIC_ERROR, values };
  }

  // With e-mail confirmation on, for a sign-up with an already confirmed address Supabase returns a user with an empty
  // identity instead of an error and sends no e-mail. this case is stated clearly; for an unconfirmed
  // old sign-up Supabase resends the confirmation e-mail and the success message below is shown.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return accountExists(values);

  // If e-mail confirmation is off (only recommended in development) the session opens immediately.
  if (data.session) redirect(ROUTES.customer);

  return {
    status: "success",
    message:
      // Spam sentence added: e-mails from a new domain land in the junk folder with some
      // providers (Outlook).
      "Kayıt talebiniz alındı. E-posta adresinize bir doğrulama bağlantısı gönderdik; hesabınızı etkinleştirmek için bu bağlantıya tıklayınız. Gelen kutunuzda göremezseniz istenmeyen (spam/gereksiz) klasörüne bakınız.",
    email: parsed.data.email,
  };
}

function accountExists(values: Record<string, string>): AuthFormState {
  return {
    status: "error",
    code: "account_exists",
    message: `${ACCOUNT_EXISTS} Giriş yapabilir veya şifrenizi unuttuysanız yenisini belirleyebilirsiniz.`,
    fieldErrors: { email: ACCOUNT_EXISTS },
    values,
  };
}

export async function signInAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  // If not ticked, the session cookies are deleted when the browser closes (see session-cookies.ts).
  const remember = text(formData, "remember") === "on";
  const values = { email: text(formData, "email"), remember: remember ? "on" : "" };
  if (!isSupabaseConfigured()) return { status: "error", message: NOT_CONFIGURED_ERROR, values };

  const email = emailSchema.safeParse(values.email);
  const password = text(formData, "password");
  if (!email.success || password === "") {
    return { status: "error", message: "E-posta adresinizi ve şifrenizi giriniz.", values };
  }

  const supabase = await createClient({ remember });
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.data,
    password,
    options: { captchaToken: parseCaptchaToken(formData.get(CAPTCHA_FIELD)) },
  });
  if (error || !data.user) {
    if (isCaptchaError(error)) return { status: "error", message: CAPTCHA_FAILED_MESSAGE, values };
    if (error?.code === "email_not_confirmed") {
      return {
        status: "error",
        message: "E-posta adresiniz henüz doğrulanmamış. Lütfen size gönderdiğimiz e-postadaki bağlantıya tıklayınız.",
        values,
      };
    }
    if (error?.status === 429) {
      return { status: "error", message: RATE_LIMITED, values };
    }
    if (error && error.code !== "invalid_credentials") logError("auth.sign_in", error);
    return { status: "error", message: "E-posta adresi veya şifre hatalı.", values };
  }

  const cookieStore = await cookies();
  const secure = process.env.NODE_ENV === "production";
  if (remember) {
    cookieStore.set(REMEMBER_COOKIE, "1", { path: "/", sameSite: "lax", secure, maxAge: REMEMBER_MAX_AGE_SECONDS });
  } else {
    cookieStore.delete(REMEMBER_COOKIE);
  }
  // The e-mail field is prefilled at the next sign-in; the password is never stored anywhere. Only if "Beni hatırla" was
  // selected (a service the user asked for): the cookie policy only allows strictly necessary cookies on the portal.
  if (remember) {
    cookieStore.set(LAST_EMAIL_COOKIE, email.data, {
      path: ROUTES.login,
      httpOnly: true,
      sameSite: "lax",
      secure,
      maxAge: LAST_EMAIL_MAX_AGE_SECONDS,
    });
  } else {
    cookieStore.delete({ name: LAST_EMAIL_COOKIE, path: ROUTES.login });
  }

  const { data: profile } = await supabase.from("profiles").select("role, is_active").eq("id", data.user.id).maybeSingle();
  const isStaff = profile?.role === "staff" && profile.is_active === true;
  const fallback = isStaff ? ROUTES.staff : ROUTES.customer;
  const next = safeInternalPath(text(formData, "next"), fallback);
  // Customers are never redirected to the admin panel, staff never to the customer panel.
  const target = next.startsWith(ROUTES.staff) === isStaff ? next : fallback;
  redirect(target);
}

export async function signOutAction(): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut();
    if (error) logError("auth.sign_out", error);
  }
  (await cookies()).delete(REMEMBER_COOKIE);
  redirect(ROUTES.login);
}

export async function requestPasswordResetAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const values = { email: text(formData, "email") };
  if (!isSupabaseConfigured()) return { status: "error", message: NOT_CONFIGURED_ERROR, values };

  const email = emailSchema.safeParse(values.email);
  if (!email.success) {
    return { status: "error", message: "Geçerli bir e-posta adresi giriniz.", fieldErrors: { email: "Geçerli bir e-posta adresi giriniz." }, values };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${getSiteUrl()}/auth/confirm?next=${encodeURIComponent(ROUTES.resetPassword)}`,
    captchaToken: parseCaptchaToken(formData.get(CAPTCHA_FIELD)),
  });
  if (error) {
    // If verification failed the e-mail was not sent; "sent" is never claimed.
    if (isCaptchaError(error)) return { status: "error", message: CAPTCHA_FAILED_MESSAGE, values };
    if (error.status === 429) {
      return { status: "error", message: RATE_LIMITED, values };
    }
    logError("auth.reset_password", error);
  }
  // Whether the address is registered is not revealed.
  return {
    status: "success",
    message: "Bu e-posta adresi sistemimizde kayıtlıysa şifre sıfırlama bağlantısı gönderildi. Lütfen gelen kutunuzu kontrol ediniz.",
    email: email.data,
  };
}

/**
 * "Bağlantıyı tekrar gönder" (resend link). Same rules as the first send: whether the address is registered is not revealed
 * (uniform response), rate limits are reported with a clear message, the e-mail address is not logged. If the e-mail service fails, this is said clearly.
 */
export async function resendAuthEmailAction(kind: unknown, emailInput: unknown, captchaInput?: unknown): Promise<{ ok: boolean; message: string }> {
  if (!isSupabaseConfigured()) return { ok: false, message: NOT_CONFIGURED_ERROR };
  if (kind !== "signup" && kind !== "recovery") return { ok: false, message: GENERIC_ERROR };
  const email = emailSchema.safeParse(emailInput);
  if (!email.success) return { ok: false, message: "Geçerli bir e-posta adresi giriniz." };

  const captchaToken = parseCaptchaToken(captchaInput);
  const supabase = await createClient();
  const { error } =
    kind === "signup"
      ? await supabase.auth.resend({
          type: "signup",
          email: email.data,
          options: { emailRedirectTo: `${getSiteUrl()}/auth/confirm?next=${encodeURIComponent(ROUTES.customer)}`, captchaToken },
        })
      : await supabase.auth.resetPasswordForEmail(email.data, {
          redirectTo: `${getSiteUrl()}/auth/confirm?next=${encodeURIComponent(ROUTES.resetPassword)}`,
          captchaToken,
        });
  if (error) {
    if (isCaptchaError(error)) return { ok: false, message: CAPTCHA_FAILED_MESSAGE };
    if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
      return { ok: false, message: RATE_LIMITED };
    }
    logError("auth.resend", { kind, code: error.code, status: error.status });
    // A server error (e.g. sending the e-mail) is told to the user; other responses are uniform so the address's status is not revealed.
    if (typeof error.status === "number" && error.status >= 500) return { ok: false, message: GENERIC_ERROR };
  }
  return {
    ok: true,
    message: kind === "signup" ? "Bağlantı tekrar gönderildi." : "Bu e-posta adresi sistemimizde kayıtlıysa bağlantı tekrar gönderildi.",
  };
}

export async function updatePasswordAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  if (!isSupabaseConfigured()) return { status: "error", message: NOT_CONFIGURED_ERROR };

  const password = passwordSchema.safeParse(text(formData, "password"));
  if (!password.success) {
    const message = password.error.issues[0]?.message ?? "Geçersiz şifre.";
    return { status: "error", message, fieldErrors: { password: message } };
  }
  if (password.data !== text(formData, "passwordConfirm")) {
    return { status: "error", message: "Şifreler birbiriyle aynı olmalıdır.", fieldErrors: { passwordConfirm: "Şifreler birbiriyle aynı olmalıdır." } };
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return {
      status: "error",
      message: "Şifre sıfırlama bağlantınızın süresi dolmuş veya bağlantı geçersiz. Lütfen yeni bir bağlantı isteyiniz.",
    };
  }
  const { error } = await supabase.auth.updateUser({ password: password.data });
  if (error) {
    if (error.code === "same_password") {
      return { status: "error", message: "Yeni şifreniz eski şifrenizle aynı olamaz.", fieldErrors: { password: "Farklı bir şifre seçiniz." } };
    }
    if (error.code === "weak_password") {
      return { status: "error", message: "Şifreniz yeterince güçlü değil.", fieldErrors: { password: "Daha güçlü bir şifre seçiniz." } };
    }
    logError("auth.update_password", error);
    return { status: "error", message: GENERIC_ERROR };
  }
  // The session does not open automatically with the new password: sessions on all devices
  // are closed and the user is sent to the sign-in page to sign in with the new password.
  const { error: signOutError } = await supabase.auth.signOut({ scope: "global" });
  if (signOutError) {
    logError("auth.update_password_sign_out", signOutError);
    await supabase.auth.signOut({ scope: "local" });
  }
  (await cookies()).delete(REMEMBER_COOKIE);
  redirect(`${ROUTES.login}?status=password-changed`);
}
