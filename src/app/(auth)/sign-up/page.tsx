import type { Metadata } from "next";
import Link from "next/link";
import { SignUpForm } from "@/components/auth/auth-forms";
import { AUTH_LINK, AuthShell } from "@/components/auth/auth-layout";
import { ROUTES } from "@/lib/site";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "Hesap oluştur" };

export default function SignUpPage() {
  return (
    <AuthShell>
      <SignUpForm
        configured={isSupabaseConfigured()}
        title="Hesap oluştur"
        description="Başvurunuzu çevrimiçi tamamlamak için bir hesap oluşturunuz. Yalnızca hesabınız için gerekli bilgiler istenir."
        footer={
          <>
            <span>Zaten hesabınız var mı?</span>
            <Link href={ROUTES.login} className={AUTH_LINK}>
              Giriş yapın
            </Link>
          </>
        }
      />
    </AuthShell>
  );
}
