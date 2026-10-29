import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/auth-forms";
import { AUTH_LINK, AuthShell } from "@/components/auth/auth-layout";
import { ROUTES } from "@/lib/site";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "Şifremi unuttum" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell>
      <ForgotPasswordForm
        configured={isSupabaseConfigured()}
        title="Şifremi unuttum"
        description="Hesabınıza kayıtlı e-posta adresini yazınız; size şifrenizi yenileyebileceğiniz bir bağlantı gönderelim."
        footer={
          <Link href={ROUTES.login} className={AUTH_LINK}>
            Giriş sayfasına dön
          </Link>
        }
      />
    </AuthShell>
  );
}
