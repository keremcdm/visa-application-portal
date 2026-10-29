import { z } from "zod";

/** The same rule for sign-up, password reset and the password change on My Account. */
export const passwordSchema = z
  .string()
  .min(8, "Şifreniz en az 8 karakter olmalıdır.")
  .max(72, "Şifreniz en fazla 72 karakter olabilir.")
  .refine((v) => /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(v) && /[0-9]/.test(v), "Şifreniz en az bir harf ve bir rakam içermelidir.");

/** E-mail address: trimmed and converted to lower case. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "E-posta adresinizi giriniz.")
  .max(254, "E-posta adresi çok uzun.")
  .email("Geçerli bir e-posta adresi giriniz.");
