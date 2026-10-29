/**
 * THE PROXY'S REDIRECT RULE
 *
 * The proxy only verifies the access token locally (getClaims); pages ask the Supabase Auth
 * server (getUser). If the session was terminated on the server but the token has not expired, the two
 * give different results. So the proxy only redirects a user from the sign-in pages to the panel if the session is also
 * verified on the server; otherwise a /panel → /sign-in → /panel loop would occur.
 *
 * This rule is only a redirect convenience; authorization lives in src/server/auth.ts and RLS.
 */
export const PROTECTED_PREFIXES = ["/panel", "/admin", "/two-factor"];
/**
 * Pages a signed-in user does not see: the entry screen ("/") and the sign-in/sign-up forms. A user with an open
 * session is redirected from them to the panel.
 */
export const AUTH_PAGES = ["/", "/sign-in", "/sign-up", "/forgot-password"];

/** "login": redirect to the sign-in page · "verify": verify on the server before redirecting to the panel · "pass": leave alone. */
export type SessionGate = "login" | "verify" | "pass";

export function sessionGate(pathname: string, hasLocalSession: boolean): SessionGate {
  if (!hasLocalSession) {
    return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) ? "login" : "pass";
  }
  return AUTH_PAGES.includes(pathname) ? "verify" : "pass";
}

/**
 * "confirmed": the session is valid on the server · "rejected": the server definitely refused the session ·
 * "unavailable": no verdict (network error, server error, rate limit).
 */
export type ServerSessionCheck = "confirmed" | "rejected" | "unavailable";

/**
 * Classifies the getUser() result. Cookies are only deleted in the "rejected" case; the user is never signed out
 * because of a temporary error.
 */
export function serverSessionCheck(userId: string | null | undefined, error: { name?: unknown; status?: unknown } | null | undefined): ServerSessionCheck {
  if (!error) return userId ? "confirmed" : "unavailable";
  if (error.name === "AuthSessionMissingError") return "rejected";
  if (error.name === "AuthApiError" && (error.status === 401 || error.status === 403 || error.status === 404)) return "rejected";
  return "unavailable";
}
