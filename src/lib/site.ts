/**
 * Fixed texts used across the site.
 * Contact details, IBAN and prices are NOT here;
 * they are kept in the Settings section of the admin panel (settings table).
 */
export const SITE = {
  companyName: "Vize Başvuru Portalı",
  productName: "Vize Başvuru Portalı",
  // Logo (public/brand/logo.svg). PNG versions are used in e-mails, the tab icon, favicon.ico and the document checklist
  // PDF; when the logo changes all of them are regenerated with: node scripts/generate-logo-assets.mjs
  logo: { src: "/brand/logo.svg", width: 1840, height: 860, alt: "Vize Başvuru Portalı" },
  // The year in the copyright line is deliberately fixed; it does not change by itself.
  copyrightNotice: "© 2026 Vize Başvuru Portalı",
} as const;

export const ROUTES = {
  home: "/",
  login: "/sign-in",
  register: "/sign-up",
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
  kvkk: "/privacy-notice",
  cookies: "/cookie-policy",
  retentionPolicy: "/data-retention-policy",
  /** Terms of service accepted when submitting an application. */
  applicationTerms: "/application-terms",
  customer: "/panel",
  customerNotifications: "/panel/notifications",
  customerRiskTest: "/panel/risk-assessment",
  customerAccount: "/panel/account",
  staff: "/admin",
  staffSettings: "/admin/settings",
  /** Two-factor authentication page for staff (setup or code entry). */
  staffMfa: "/two-factor",
  /** Page where the recovery code is created right after setup. */
  staffMfaRecoveryCode: "/two-factor/recovery-code",
} as const;

/** Text shown on not-found pages (not-found.tsx files). */
export const NOT_FOUND_PAGE = {
  title: "Sayfa bulunamadı",
  description: "Aradığınız sayfa mevcut değil veya bu sayfayı görüntüleme yetkiniz yok.",
} as const;

/**
 * Error pages that routes opened through links (file view, form PDF) redirect to when refused.
 * The addresses carry only the error type; never a record or file id.
 */
export const ERROR_PAGES = {
  file: { path: "/errors/file", title: "Dosya açılamadı", description: "Bu dosya mevcut değil veya görüntüleme yetkiniz yok." },
  forbidden: { path: "/errors/forbidden", title: "Bu işlem için yetkiniz yok", description: "Bu belgeyi yalnızca yetkili personel indirebilir." },
  record: { path: "/errors/record", title: "Kayıt bulunamadı", description: "Aradığınız kayıt mevcut değil veya görüntüleme yetkiniz yok." },
  temporary: { path: "/errors/temporary", title: "İşlem tamamlanamadı", description: "Bir sorun oluştu. Lütfen tekrar deneyiniz." },
} as const;

export type ErrorPageKind = keyof typeof ERROR_PAGES;

/** Sign-in address a user with an expired session is redirected to (the notice text is on the sign-in page). */
export const SESSION_EXPIRED_LOGIN_PATH = `${ROUTES.login}?status=session-expired`;

/**
 * Legal links in every footer (entry screen, sign-in/sign-up/password pages, legal pages, customer and admin
 * panels): the legal counsel's three texts. The site has no Privacy Policy or Terms of Use.
 */
export const LEGAL_FOOTER_LINKS = [
  { href: ROUTES.kvkk, title: "KVKK Aydınlatma Metni" },
  { href: ROUTES.retentionPolicy, title: "Veri Saklama ve İmha Politikası" },
  { href: ROUTES.cookies, title: "Çerez Politikası" },
] as const;

export function customerApplicationPath(id: string, step?: string): string {
  return step ? `/panel/applications/${id}/${step}` : `/panel/applications/${id}`;
}

/** Id of a document row on the Documents page ("document-<id>"). */
export function documentAnchor(slotId: string): string {
  return `document-${slotId}`;
}

/** Address going straight to a document on the Documents page (the document is highlighted). */
export function customerDocumentPath(applicationId: string, slotId: string): string {
  return `${customerApplicationPath(applicationId, "documents")}#${documentAnchor(slotId)}`;
}

export function staffApplicationPath(id: string, tab?: string): string {
  return tab ? `/admin/applications/${id}?tab=${tab}` : `/admin/applications/${id}`;
}

/** Only in-app paths starting with known prefixes can be redirect targets (open redirect protection). */
export function safeInternalPath(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f]/.test(value)) return fallback;
  const allowed = [ROUTES.customer, ROUTES.staff, ROUTES.resetPassword];
  return allowed.some((prefix) => value === prefix || value.startsWith(`${prefix}/`) || value.startsWith(`${prefix}?`)) ? value : fallback;
}
