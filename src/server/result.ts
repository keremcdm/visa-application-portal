/** Result that server actions return to the client. Contains no raw error details. */
export type ActionResult<T = undefined> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

export const GENERIC_ERROR = "İşlem tamamlanamadı. Lütfen tekrar deneyiniz. Sorun devam ederse bizimle iletişime geçiniz.";
export const NOT_CONFIGURED_ERROR =
  "Sistem bağlantısı henüz yapılandırılmadığı için bu işlem şu anda yapılamıyor.";
export const SESSION_EXPIRED_ERROR = "Oturumunuz sona ermiş. Lütfen yeniden giriş yapınız.";
export const FORBIDDEN_ERROR = "Bu işlem için yetkiniz bulunmuyor.";
export const ADMIN_REQUIRED_ERROR = "Bu işlemi yalnızca yöneticiler yapabilir.";
export const MFA_REQUIRED_ERROR = "Bu işlem için iki adımlı doğrulama gerekiyor. Sayfayı yenileyip doğrulama kodunuzu giriniz.";
export const NOT_FOUND_ERROR = "Kayıt bulunamadı.";

export function fail(message: string, fieldErrors?: Record<string, string>): { ok: false; message: string; fieldErrors?: Record<string, string> } {
  return fieldErrors ? { ok: false, message, fieldErrors } : { ok: false, message };
}

export function ok<T = undefined>(message?: string, data?: T): { ok: true; message?: string; data?: T } {
  return { ok: true, message, data };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
