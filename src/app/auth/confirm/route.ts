import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { ROUTES, safeInternalPath } from "@/lib/site";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/server/log";

const OTP_TYPES: readonly EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

/**
 * Return address of the verification links in e-mails.
 * Supports both link formats:
 *   - ?token_hash=...&type=...   (recommended; configured in the Supabase e-mail templates, see README)
 *   - ?code=...                  (the default PKCE link)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const code = searchParams.get("code");

  const redirectTo = (path: string) => {
    const url = request.nextUrl.clone();
    url.pathname = path.split("?")[0]!;
    url.search = path.includes("?") ? `?${path.split("?")[1]}` : "";
    return NextResponse.redirect(url);
  };
  const failure = () => redirectTo(`${ROUTES.login}?status=invalid-link`);

  if (!isSupabaseConfigured()) return failure();

  // Invitation and password reset links always go to the set-password page.
  const isPasswordFlow = type === "recovery" || type === "invite";
  const next = isPasswordFlow ? ROUTES.resetPassword : safeInternalPath(searchParams.get("next"), ROUTES.customer);

  const supabase = await createClient();

  if (tokenHash && type && (OTP_TYPES as readonly string[]).includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ type: type as EmailOtpType, token_hash: tokenHash });
    if (error) {
      logError("auth.confirm.verify_otp", error);
      return failure();
    }
    return redirectTo(next);
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      logError("auth.confirm.exchange_code", error);
      return failure();
    }
    return redirectTo(next);
  }

  // Secure e-mail change (old and new addresses are confirmed separately): after the first confirmation Supabase returns
  // only an informational message instead of a code. The change is not complete yet; the user is told to confirm the other link.
  if (searchParams.get("message") && !searchParams.get("error")) {
    return redirectTo(`${ROUTES.customerAccount}?status=email-confirm-other`);
  }

  return failure();
}
