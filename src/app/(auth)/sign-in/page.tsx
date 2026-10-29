import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { SignInForm } from "@/components/auth/auth-forms";
import { AUTH_LINK, AuthShell } from "@/components/auth/auth-layout";
import { RegisterLink } from "@/components/auth/register-link";
import { safeInternalPath } from "@/lib/site";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { LAST_EMAIL_COOKIE } from "@/lib/supabase/session-cookies";

export const metadata: Metadata = { title: "Giriş" };

const NOTICES: Record<string, { text: string; tone: "warning" | "success" }> = {
  "invalid-link": { tone: "warning", text: "Bağlantı geçersiz veya süresi dolmuş. Lütfen giriş yapınız ya da yeni bir bağlantı isteyiniz." },
  // When a file or form PDF link is opened after the session has expired (SESSION_EXPIRED_LOGIN_PATH).
  "session-expired": { tone: "warning", text: "Oturumunuz sona ermiş. Lütfen yeniden giriş yapınız." },
  // When the customer deleted their account from the My Account page (src/server/actions/account.ts).
  "account-deleted": { tone: "success", text: "Hesabınız, taslak başvurularınız ve yüklediğiniz belgeler silindi." },
  // When a new password was set through a password reset link (updatePasswordAction).
  "password-changed": { tone: "success", text: "Şifreniz değiştirildi. Lütfen yeni şifrenizle giriş yapınız." },
};

const FRAME = {
  title: "Giriş",
  description: "Başvurunuza devam etmek veya durumunu görmek için hesabınıza giriş yapınız.",
  footer: (
    <>
      <span>Hesabınız yok mu?</span>
      <RegisterLink className={AUTH_LINK}>Hesap oluşturun</RegisterLink>
    </>
  ),
};

async function SignInWithParams({ searchParams }: Pick<PageProps<"/sign-in">, "searchParams">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? safeInternalPath(params.next, "") : "";
  const notice = typeof params.status === "string" ? NOTICES[params.status] : undefined;
  // The cookie comes from the user's browser; if well-formed it is only used to prefill the e-mail field.
  const stored = (await cookies()).get(LAST_EMAIL_COOKIE)?.value ?? "";
  const lastEmail = stored.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(stored) ? stored : undefined;
  return <SignInForm {...FRAME} configured={isSupabaseConfigured()} next={next || undefined} notice={notice} lastEmail={lastEmail} />;
}

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const configured = isSupabaseConfigured();
  return (
    <AuthShell>
      <Suspense fallback={<SignInForm {...FRAME} configured={configured} />}>
        <SignInWithParams searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}
