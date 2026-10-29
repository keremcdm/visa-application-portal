/**
 * "REMEMBER ME"
 *
 * Supabase always writes the session cookies with a 400-day lifetime; the session stays open even if the browser closes.
 * If the customer did not tick "Beni hatırla" (remember me) at sign-in, the cookies are written without a lifetime (as session
 * cookies) and deleted when the browser is closed. The preference is kept in the REMEMBER_COOKIE cookie.
 *
 * Session cookies are written in three places and all three apply the rule here:
 * the server client (server.ts), the proxy (proxy.ts) and the browser client (browser.ts).
 * If one is skipped, the cookie becomes persistent again when the session refreshes.
 *
 * This file also runs in the browser; it imports nothing server-specific.
 */

/** If the value is "1" the session is persistent. Not httpOnly because the browser client reads it too; it holds no secret. */
export const REMEMBER_COOKIE = "vbp-remember";
/** The same lifetime Supabase gives its session cookies (the maximum browsers allow). */
export const REMEMBER_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

/** Address of the last successful sign-in, used to prefill the e-mail field on the sign-in screen; only written if "Beni hatırla" was selected. Only the server reads it. */
export const LAST_EMAIL_COOKIE = "vbp-last-email";
export const LAST_EMAIL_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

export function isRemembered(value: string | null | undefined): boolean {
  return value === "1";
}

export type CookieAttributes = {
  maxAge?: number;
  expires?: Date;
  domain?: string;
  path?: string;
  secure?: boolean;
  sameSite?: boolean | "lax" | "strict" | "none";
};

/**
 * Removes the cookie's lifetime if the session is not remembered.
 * Deletion cookies (maxAge: 0) are left alone; otherwise the cookie would not be deleted on sign-out.
 */
export function sessionCookieOptions<T extends { maxAge?: number; expires?: unknown }>(options: T, remember: boolean): T {
  if (remember || options.maxAge === 0) return options;
  const rest = { ...options };
  delete rest.maxAge;
  delete rest.expires;
  return rest;
}

/** Turns the `document.cookie` string into a name-value list. If a name appears more than once the first one wins. */
export function parseCookieHeader(header: string): { name: string; value: string }[] {
  const result: { name: string; value: string }[] = [];
  const seen = new Set<string>();
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (name === "" || seen.has(name)) continue;
    seen.add(name);
    const raw = part.slice(separator + 1).trim();
    let value = raw;
    try {
      value = decodeURIComponent(raw);
    } catch {
      // An invalidly encoded value is left as is.
    }
    result.push({ name, value });
  }
  return result;
}

/** Cookie string to use in a `document.cookie` assignment. HttpOnly is omitted because the browser cannot write it. */
export function serializeCookie(name: string, value: string, attributes: CookieAttributes = {}): string {
  let text = `${name}=${encodeURIComponent(value)}`;
  if (attributes.maxAge !== undefined) text += `; Max-Age=${Math.floor(attributes.maxAge)}`;
  if (attributes.domain) text += `; Domain=${attributes.domain}`;
  if (attributes.path) text += `; Path=${attributes.path}`;
  if (attributes.expires) text += `; Expires=${attributes.expires.toUTCString()}`;
  if (attributes.secure) text += "; Secure";
  const sameSite = attributes.sameSite === true ? "strict" : attributes.sameSite;
  if (sameSite === "strict") text += "; SameSite=Strict";
  else if (sameSite === "lax") text += "; SameSite=Lax";
  else if (sameSite === "none") text += "; SameSite=None";
  return text;
}
