import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { Check, TriangleAlert } from "lucide-react";
import { SaveIndicator, SaveStatusProvider } from "@/components/application-form/save-status";
import { SectionForm } from "@/components/application-form/section-form";
import { WizardHeader, WizardShell } from "@/components/customer/wizard/shell";
import { WizardCard, WizardLoading, WizNote } from "@/components/customer/wizard/ui";
import { cn } from "@/components/ui/primitives";
import { FORM_SECTIONS, isSectionId } from "@/features/application-form/definition";
import { buildRiskPrefill, pendingPrefillForForm } from "@/features/risk-test/prefill";
import { customerApplicationPath } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";
import { listAvailableHelpImages, loadApplicationContext } from "@/server/data/customer";
import { fetchRiskAssessment } from "@/server/data/queries";

export const metadata: Metadata = { title: "Başvuru formu" };

async function Content({ params }: Pick<PageProps<"/panel/applications/[id]/form/[section]">, "params">) {
  const { id, section: sectionId } = await params;
  if (!isSectionId(sectionId)) notFound();
  const ctx = await loadApplicationContext(id);
  // If the form is locked (submitted and not reopened by the consultant) it cannot be edited; answers are shown on the summary page.
  if (ctx.application.formLocked) redirect(customerApplicationPath(id, "summary"));

  const isDraft = ctx.application.status === "draft";
  const index = FORM_SECTIONS.findIndex((s) => s.id === sectionId);
  const section = FORM_SECTIONS[index]!;
  const previous = FORM_SECTIONS[index - 1];
  const next = FORM_SECTIONS[index + 1];
  const afterLast = customerApplicationPath(id, isDraft ? "documents" : "summary");

  // If the risk assessment test was taken, a single autofill suggestion is prepared for matching fields that are still empty
  // ANYWHERE in the form (whichever section is open). No field is filled without the customer's approval.
  const riskAssessment = await fetchRiskAssessment(await createClient(), ctx.user.id);
  const prefill = riskAssessment ? pendingPrefillForForm(ctx.formData, buildRiskPrefill(riskAssessment.answers)) : [];
  const completedSections = FORM_SECTIONS.filter((item) => ctx.formValidation.sections[item.id].status === "complete").length;

  return (
    <SaveStatusProvider>
      <WizardHeader application={ctx.application} current={isDraft ? "form" : "summary"} steps={ctx.steps} aside={<SaveIndicator />} />
      {!isDraft ? (
        <WizNote tone="info" title="Formunuz düzeltme için açıldı" onPage>
          Danışmanınız form cevaplarınızı güncellemeniz için formu yeniden açtı. Değişiklikleriniz kaydedildiğinde danışmanınız görebilir.
        </WizNote>
      ) : null}
      <div className="grid items-start gap-6 lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-10">
        <nav aria-label="Form bölümleri" className="flex min-w-0 flex-col gap-[18px] lg:sticky lg:top-6">
          <div className="flex flex-col gap-2 px-3.5">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-dash-ink-3">Başvuru formu</p>
            <p className="text-[13px] text-dash-ink-2">
              {completedSections} / {FORM_SECTIONS.length} bölüm tamamlandı
            </p>
            <span aria-hidden className="flex h-1 overflow-hidden rounded-full bg-dash-field">
              <span className="rounded-full bg-dash-green" style={{ width: `${(completedSections / FORM_SECTIONS.length) * 100}%` }} />
            </span>
          </div>
          <ol className="relative flex gap-0.5 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
            {FORM_SECTIONS.map((item, itemIndex) => {
              const status = ctx.formValidation.sections[item.id].status;
              const active = item.id === sectionId;
              return (
                <li key={item.id} className="shrink-0">
                  <Link
                    href={customerApplicationPath(id, `form/${item.id}`)}
                    aria-current={active ? "step" : undefined}
                    className={cn(
                      "flex min-h-11 items-center gap-3 rounded-[14px] px-3.5 py-2.5 text-sm transition-colors motion-reduce:transition-none",
                      active
                        ? "bg-white font-bold text-dash-navy shadow-[0_1px_3px_color-mix(in_srgb,var(--color-dash-navy)_8%,transparent)]"
                        : "font-medium text-dash-ink-2 hover:bg-white",
                    )}
                  >
                    {/* Number (01–09): current section in red; completed ones get a green tick, incomplete ones (if not current) a yellow warning. */}
                    <span aria-hidden className="flex w-5 flex-none items-center text-xs font-bold tabular-nums">
                      {status === "complete" ? (
                        <Check className="size-[13px] text-dash-green-ink" strokeWidth={3.5} />
                      ) : status === "incomplete" && !active ? (
                        <TriangleAlert className="size-[15px] text-dash-draft-ink" strokeWidth={2.5} />
                      ) : (
                        <span className={active ? "text-dash-red" : "text-dash-ink-4"}>{String(itemIndex + 1).padStart(2, "0")}</span>
                      )}
                    </span>
                    <span className="whitespace-nowrap lg:whitespace-normal">{item.title}</span>
                    <span className="sr-only">
                      {status === "complete" ? " (tamamlandı)" : status === "incomplete" ? " (eksik var)" : " (doldurulmadı)"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>

        <WizardCard
          eyebrow={`Bölüm ${index + 1} / ${FORM_SECTIONS.length}`}
          title={section.title}
          description={
            <p>
              <span className="text-dash-red" aria-hidden>
                *
              </span>{" "}
              işaretli alanlar zorunludur. Cevaplarınız yazdıkça otomatik kaydedilir.
            </p>
          }
        >
          <SectionForm
            // Component state resets when the section changes.
            key={section.id}
            applicationId={id}
            sectionId={section.id}
            initialData={ctx.formData[section.id] ?? {}}
            rootData={ctx.formData}
            prefill={prefill}
            today={ctx.today}
            availableHelpImages={listAvailableHelpImages()}
            prevHref={previous ? customerApplicationPath(id, `form/${previous.id}`) : isDraft ? customerApplicationPath(id, "type") : null}
            nextHref={next ? customerApplicationPath(id, `form/${next.id}`) : afterLast}
            nextLabel="Kaydet ve devam et"
          />
        </WizardCard>
      </div>
    </SaveStatusProvider>
  );
}

export default function FormSectionPage({ params }: PageProps<"/panel/applications/[id]/form/[section]">) {
  return (
    <WizardShell>
      <Suspense fallback={<WizardLoading lines={6} />}>
        <Content params={params} />
      </Suspense>
    </WizardShell>
  );
}
