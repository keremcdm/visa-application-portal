import "server-only";
import { createClient } from "@supabase/supabase-js";
import { isCaptchaError } from "@/features/auth/captcha";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { logError } from "./log";

/** `captcha`: with CAPTCHA enabled, the token is missing or invalid. */
export type PasswordCheck = "ok" | "wrong" | "rate_limited" | "captcha" | "error";

/**
 * Before changing the e-mail or password on My Account the current password is verified (so someone who hijacked the
 * session cannot take over the account). Verification uses a separate, non-persistent client that does not touch the user's
 * cookies; the temporary session it opens is closed immediately (only that session, not the user's other sessions).
 * E-mail and password are never logged.
 */
export async function verifyCurrentPassword(email: string, password: string, captchaToken: string | undefined): Promise<PasswordCheck> {
  const env = getSupabasePublicEnv();
  if (!env) return "error";
  const probe = createClient(env.url, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await probe.auth.signInWithPassword({ email, password, options: { captchaToken } });
  if (error) {
    if (isCaptchaError(error)) return "captcha";
    if (error.code === "invalid_credentials") return "wrong";
    if (error.code === "over_request_rate_limit" || error.status === 429) return "rate_limited";
    logError("auth.verify_current_password", { code: error.code, status: error.status });
    return "error";
  }
  if (data.session) {
    const { error: signOutError } = await probe.auth.signOut({ scope: "local" });
    if (signOutError) logError("auth.verify_current_password.sign_out", { code: signOutError.code, status: signOutError.status });
  }
  return "ok";
}
