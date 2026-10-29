import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "./env";
import { SupabaseNotConfiguredError } from "./server";

/**
 * SERVICE ROLE client — BYPASSES RLS.
 *
 * Rules:
 *  - Runs only on the server (`server-only`); the key is never sent to the browser.
 *  - Calling code must verify the user's identity and permission BEFORE using this client
 *    (see src/server/auth.ts and src/server/actions/*).
 *  - Wherever possible the client running with the user's own session is preferred instead.
 */
export function createAdminClient(): SupabaseClient {
  const env = getSupabasePublicEnv();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!env || !secretKey) throw new SupabaseNotConfiguredError();
  return createClient(env.url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function isAdminClientConfigured(): boolean {
  return getSupabasePublicEnv() !== null && Boolean(process.env.SUPABASE_SECRET_KEY?.trim());
}
