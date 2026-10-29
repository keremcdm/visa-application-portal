import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isRemembered, parseCookieHeader, REMEMBER_COOKIE, serializeCookie, sessionCookieOptions } from "./session-cookies";

let client: SupabaseClient | null = null;

/**
 * Browser client. Only used to upload a file to the single-use signed URL issued by the server;
 * data reads/writes go through the server. The key here is the publishable key.
 *
 * This client refreshes a session that is about to expire by itself and rewrites the cookies. If "Beni hatırla" (remember me)
 * was not selected, writing is customized here so those cookies are also deleted when the browser closes.
 */
export function getBrowserClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  client ??= createBrowserClient(url, key, {
    cookies: {
      getAll() {
        return parseCookieHeader(document.cookie);
      },
      setAll(cookiesToSet) {
        const remember = isRemembered(parseCookieHeader(document.cookie).find((cookie) => cookie.name === REMEMBER_COOKIE)?.value);
        for (const { name, value, options } of cookiesToSet) {
          document.cookie = serializeCookie(name, value, sessionCookieOptions(options, remember));
        }
      },
    },
  });
  return client;
}
