import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCard, AuthHeading, AuthShell } from "@/components/auth/auth-layout";
import { RecoveryCodePanel } from "@/components/auth/recovery-code-panel";
import { ROUTES } from "@/lib/site";
import { requireStaff } from "@/server/auth";

export const metadata: Metadata = { title: "Yedek kod" };

/**
 * Page where the recovery code is created right after two-factor authentication is set up.
 * Only opens in a staff session that has completed two-factor authentication.
 */
async function Content() {
  await requireStaff();
  return (
    <AuthCard>
      <AuthHeading
        title="Yedek kodunuzu kaydedin"
        description="Telefonunuzu veya doğrulama uygulamanızı kaybederseniz giriş yapabilmeniz için bir yedek kod oluşturun. Kod yalnızca bir kez gösterilir; güvenli bir yere kaydedin."
      />
      <RecoveryCodePanel variant="auth" continueHref={ROUTES.staff} />
    </AuthCard>
  );
}

export default function StaffRecoveryCodePage() {
  return (
    <AuthShell>
      <Suspense fallback={<AuthCard>{null}</AuthCard>}>
        <Content />
      </Suspense>
    </AuthShell>
  );
}
