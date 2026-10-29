import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getSupabasePublicEnv } from "./env";
import { isRemembered, REMEMBER_COOKIE, sessionCookieOptions } from "./session-cookies";

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super("Supabase bağlantısı yapılandırılmamış (.env.local dosyasını kontrol edin).");
    this.name = "SupabaseNotConfiguredError";
  }
}

/**
 * Supabase client running with the signed-in user's identity.
 * All queries are subject to the RLS policies in the database.
 * A new client must be created for every request; it is never shared between requests.
 */
export async function createClient(options?: { remember?: boolean }): Promise<SupabaseClient> {
  const env = getSupabasePublicEnv();
  if (!env) throw new SupabaseNotConfiguredError();
  const cookieStore = await cookies();
  // The sign-in action takes the preference from the form and passes it as `remember`; everywhere else it is read from the cookie.
  const remember = options?.remember ?? isRemembered(cookieStore.get(REMEMBER_COOKIE)?.value);

  return createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, sessionCookieOptions(options, remember));
          }
        } catch {
          // Cookies cannot be written inside a Server Component; proxy.ts takes care of refreshing the session.
        }
      },
    },
  });
}
