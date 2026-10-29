import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SetupForm } from "@/components/customer/setup-form";
import { WizardHeader, WizardShell } from "@/components/customer/wizard/shell";
import { WizardCard, WizardLoading } from "@/components/customer/wizard/ui";
import { customerApplicationPath } from "@/lib/site";
import { loadApplicationContext } from "@/server/data/customer";

export const metadata: Metadata = { title: "Başvuru tipi" };

async function Content({ params }: Pick<PageProps<"/panel/applications/[id]/type">, "params">) {
  const { id } = await params;
  const ctx = await loadApplicationContext(id);
  if (ctx.application.status !== "draft") redirect(customerApplicationPath(id));

  return (
    <>
      <WizardHeader application={ctx.application} current="type" steps={ctx.steps} />
      <WizardCard eyebrow="Adım 1 / 6" title="Başvuru tipi">
        <SetupForm
          applicationId={id}
          initialTypes={ctx.application.applicationTypes}
          initialSponsorStatus={ctx.application.sponsorStatus}
          nextHref={customerApplicationPath(id, "form/personal")}
        />
      </WizardCard>
    </>
  );
}

export default function ApplicationTypePage({ params }: PageProps<"/panel/applications/[id]/type">) {
  return (
    <WizardShell>
      <Suspense fallback={<WizardLoading />}>
        <Content params={params} />
      </Suspense>
    </WizardShell>
  );
}
