/**
 * CAPTCHA: Cloudflare Turnstile. Supabase does the verification (the secret key is entered under Authentication →
 * Attack Protection); the app only adds the token obtained in the browser to sign-in, sign-up, password reset,
 * "bağlantıyı tekrar gönder" (resend link) and the current-password check on My Account.
 * The site key is NEXT_PUBLIC_TURNSTILE_SITE_KEY; if it is not set the verification box is never shown.
 */

/** Name of the hidden field in the form. */
export const CAPTCHA_FIELD = "captchaToken";

export const CAPTCHA_FAILED_MESSAGE =
  "Güvenlik doğrulaması tamamlanamadı. Birkaç saniye bekleyip tekrar deneyiniz; doğrulama kutusu çıkarsa onu da işaretleyiniz. Sorun sürerse sayfayı yenileyiniz.";

/** Token from the form (untrusted data): only text of reasonable length without whitespace or control characters. */
export function parseCaptchaToken(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.length > 0 && value.length <= 4096 && /^[\x21-\x7e]+$/.test(value) ? value : undefined;
}

/** Supabase responds with this code if the token is missing or invalid. */
export function isCaptchaError(error: { code?: string } | null | undefined): boolean {
  return error?.code === "captcha_failed";
}
