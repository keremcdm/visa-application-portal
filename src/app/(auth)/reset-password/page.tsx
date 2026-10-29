import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/auth-forms";
import { AuthShell } from "@/components/auth/auth-layout";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "Yeni şifre belirle" };

export default function ResetPasswordPage() {
  return (
    <AuthShell>
      <ResetPasswordForm configured={isSupabaseConfigured()} title="Yeni şifre belirle" description="Hesabınız için yeni bir şifre belirleyiniz." />
    </AuthShell>
  );
}
