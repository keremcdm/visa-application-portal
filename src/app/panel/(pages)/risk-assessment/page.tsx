import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { RiskTest } from "@/components/customer/risk-test";
import { LoadingBlock } from "@/components/ui/primitives";
import { ROUTES } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";
import { requireCustomer } from "@/server/auth";
import { companyContactFrom, fetchRiskAssessment, fetchSettings } from "@/server/data/queries";

export const metadata: Metadata = { title: "Risk Analiz Testi" };

/** Optional eligibility test recommended before applying. */
async function Content() {
  const user = await requireCustomer();
  const supabase = await createClient();
  const [saved, settings] = await Promise.all([fetchRiskAssessment(supabase, user.id), fetchSettings(supabase)]);

  return (
    <>
      <p className="mb-5 text-sm">
        <Link href={ROUTES.customer} className="text-brand-700 underline-offset-4 hover:underline">
          Başvurularım
        </Link>
        <span className="text-muted"> / Risk Analiz Testi</span>
      </p>
      <RiskTest initialAnswers={saved?.answers ?? null} contact={companyContactFrom(settings)} homeHref={ROUTES.customer} />
    </>
  );
}

export default function RiskTestPage() {
  return (
    <Suspense fallback={<LoadingBlock label="Test yükleniyor…" />}>
      <Content />
    </Suspense>
  );
}
