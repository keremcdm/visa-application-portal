import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthCard, AuthShell } from "@/components/auth/auth-layout";
import { MfaForm } from "@/components/auth/mfa-form";
import { ROUTES } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";
import { isStaffAccount, requireUser } from "@/server/auth";
import { logError } from "@/server/log";
import { DataError } from "@/server/data/queries";

export const metadata: Metadata = { title: "İki adımlı doğrulama" };

/**
 * Two-factor authentication page for staff. The admin panel redirects staff sessions that have not entered a code
 * here (src/server/auth.ts → requireStaff). A customer landing here is sent back to their own panel.
 */
async function Content() {
  const user = await requireUser();
  if (!isStaffAccount(user)) redirect(ROUTES.customer);
  if (user.aal === "aal2") redirect(ROUTES.staff);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) {
    logError("mfa.page.list", error);
    throw new DataError("mfa_factors");
  }
  return <MfaForm mode={data.totp.length > 0 ? "verify" : "enroll"} email={user.email} />;
}

export default function StaffMfaPage() {
  return (
    <AuthShell>
      <Suspense fallback={<AuthCard>{null}</AuthCard>}>
        <Content />
      </Suspense>
    </AuthShell>
  );
}
