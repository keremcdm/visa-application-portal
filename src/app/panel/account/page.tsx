import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountView } from "@/components/customer/account/account-view";
import { WizardShell } from "@/components/customer/wizard/shell";
import { WizardLoading } from "@/components/customer/wizard/ui";
import { createClient } from "@/lib/supabase/server";
import { formatDateTimeTr, todayInIstanbul } from "@/lib/validation/formats";
import { requireCustomer } from "@/server/auth";
import { loadAccountDeletionState } from "@/server/data/account";
import { DataError } from "@/server/data/queries";
import { logError } from "@/server/log";

export const metadata: Metadata = { title: "Hesabım" };

/** Notices shown when returning from the verification link in an e-mail (src/app/auth/confirm/route.ts). */
const NOTICES: Record<string, { tone: "success" | "info"; text: string }> = {
  "email-changed": { tone: "success", text: "E-posta adresiniz değiştirildi. Bundan sonra yeni adresinizle giriş yapınız." },
  "email-confirm-other": {
    tone: "info",
    text: "Bağlantılardan biri onaylandı. Değişikliğin tamamlanması için diğer adresinize gönderilen bağlantıyı da onaylayınız.",
  },
};

async function Account({ searchParams }: Pick<PageProps<"/panel/account">, "searchParams">) {
  const user = await requireCustomer();
  const params = await searchParams;
  const supabase = await createClient();
  // RLS: users can only read their own profile. A new e-mail awaiting confirmation is read from the Auth record.
  const [{ data, error }, deletion, authUser] = await Promise.all([
    supabase.from("profiles").select("email, first_name, last_name, birth_date, created_at").eq("id", user.id).maybeSingle(),
    loadAccountDeletionState(),
    supabase.auth.getUser(),
  ]);
  if (error || !data) {
    if (error) logError("data.profile", error);
    throw new DataError("profile");
  }

  return (
    <AccountView
      firstName={typeof data.first_name === "string" ? data.first_name : ""}
      lastName={typeof data.last_name === "string" ? data.last_name : ""}
      birthDate={typeof data.birth_date === "string" ? data.birth_date : ""}
      email={String(data.email)}
      createdAtText={formatDateTimeTr(String(data.created_at))}
      pendingEmail={authUser.data.user?.new_email ?? null}
      notice={typeof params.status === "string" ? NOTICES[params.status] : undefined}
      deletion={deletion}
      today={todayInIstanbul()}
    />
  );
}

export default function AccountPage({ searchParams }: PageProps<"/panel/account">) {
  return (
    <WizardShell>
      <Suspense fallback={<WizardLoading label="Hesap bilgileriniz yükleniyor…" />}>
        <Account searchParams={searchParams} />
      </Suspense>
    </WizardShell>
  );
}
