import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FormEditControls } from "@/components/customer/form-edit-controls";
import { SubmitApplication } from "@/components/customer/submit-application";
import { WizardHeader, WizardShell } from "@/components/customer/wizard/shell";
import {
  StatusPill,
  SummaryCard,
  WizardBody,
  WizardCard,
  WizardLoading,
  wizButtonClass,
  WizLinkButton,
  WizNote,
  WizTag,
} from "@/components/customer/wizard/ui";
import { FormAnswers } from "@/components/shared/form-answers";
import { formEditState } from "@/features/applications/form-edit";
import type { SubmissionStep } from "@/features/applications/submission";
import { documentCompletion } from "@/features/documents/rules";
import { cityOptionLabel } from "@/features/pricing/surcharge";
import { APPLICATION_TYPE_LABELS, APPOINTMENT_SLOT_LABELS, SPONSOR_STATUS_LABELS } from "@/lib/domain/constants";
import { customerApplicationPath } from "@/lib/site";
import { formatDateLongTr } from "@/lib/validation/formats";
import { loadApplicationContext, slotState } from "@/server/data/customer";

export const metadata: Metadata = { title: "Özet" };

const STEP_PATH: Record<SubmissionStep, string> = {
  type: "type",
  form: "form/personal",
  documents: "documents",
  appointment: "appointment",
};

async function Content({ params }: Pick<PageProps<"/panel/applications/[id]/summary">, "params">) {
  const { id } = await params;
  const ctx = await loadApplicationContext(id);
  const selectedCity = ctx.cities.find((c) => c.id === ctx.application.cityId);
  const { application } = ctx;
  const isDraft = application.status === "draft";
  const canEditForm = !application.formLocked;
  // For a submitted application: open for correction / request with the consultant / request can be sent.
  const editState = isDraft ? "closed" : formEditState(application);
  const editLink = (path: string, label: string) => (
    <Link href={customerApplicationPath(id, path)} className={wizButtonClass("secondary", "sm")}>
      {label}
    </Link>
  );

  return (
    <>
      <WizardHeader application={application} current="summary" steps={ctx.steps} />
      <div className="flex flex-col gap-4">
        <WizardCard
          eyebrow={isDraft ? "Adım 6 / 6" : undefined}
          title={isDraft ? "Özet ve gönder" : "Form cevaplarım"}
          description={
            <p>
              {isDraft
                ? "Göndermeden önce bilgilerinizi kontrol ediniz. Gönderdikten sonra cevaplarınızı yalnızca danışmanınız yeniden açarsa değiştirebilirsiniz."
                : "Başvuru formunda verdiğiniz cevaplar aşağıdadır."}
            </p>
          }
        >
          {editState !== "closed" || (isDraft && ctx.issues.length > 0) ? (
            <WizardBody>
              <FormEditControls applicationId={id} state={editState} requestNote={application.formEditRequestNote} />

              {isDraft && ctx.issues.length > 0 ? (
                <WizNote tone="warning" title="Başvurunuzu göndermeden önce tamamlamanız gerekenler" role="status">
                  <ul className="mt-1.5 flex flex-col gap-2.5">
                    {ctx.issues.map((issue, index) => (
                      <li key={index} className="flex items-baseline gap-2.5">
                        <span aria-hidden className="size-[5px] flex-none -translate-y-0.5 rounded-full bg-dash-draft-ink" />
                        <span className="min-w-0 flex-1">{issue.message}</span>{" "}
                        <Link
                          href={customerApplicationPath(id, issue.sectionId ? `form/${issue.sectionId}` : STEP_PATH[issue.step])}
                          className="flex-none text-[13px] font-bold text-dash-navy underline underline-offset-[3px] hover:text-dash-red"
                        >
                          Düzelt
                        </Link>
                      </li>
                    ))}
                  </ul>
                </WizNote>
              ) : null}
            </WizardBody>
          ) : (
            <div aria-hidden className="pb-8" />
          )}
        </WizardCard>

        {isDraft ? (
          <>
            <SummaryCard title="Başvuru tipi" action={editLink("type", "Düzenle")}>
              {application.applicationTypes.length === 0 ? (
                <p className="text-sm text-dash-ink-4">Seçilmedi.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {application.applicationTypes.map((type) => (
                    <WizTag key={type}>{APPLICATION_TYPE_LABELS[type]}</WizTag>
                  ))}
                  {application.sponsorStatus ? <WizTag>Sponsor: {SPONSOR_STATUS_LABELS[application.sponsorStatus]}</WizTag> : null}
                </div>
              )}
            </SummaryCard>

            <SummaryCard title="Evraklar" action={editLink("documents", "Düzenle")}>
              {ctx.slots.length === 0 ? (
                <p className="text-sm text-dash-ink-4">Evrak listesi başvuru tipi seçildikten sonra oluşur.</p>
              ) : (
                <ul>
                  {ctx.slots
                    .filter((s) => !s.outOfScope)
                    .map((slot) => {
                      const completion = documentCompletion(slotState(slot));
                      return (
                        <li key={slot.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t border-dash-line-soft py-3">
                          <span className="min-w-0 flex-1 text-sm">{slot.label}</span>
                          {completion === "complete" ? (
                            <StatusPill tone="done" size="sm">
                              {slot.files.length} dosya
                            </StatusPill>
                          ) : completion === "missing" ? (
                            <StatusPill tone="waiting" size="sm">
                              Bekleniyor
                            </StatusPill>
                          ) : (
                            <StatusPill tone="neutral" size="sm">
                              Yüklenmedi (isteğe bağlı)
                            </StatusPill>
                          )}
                        </li>
                      );
                    })}
                </ul>
              )}
            </SummaryCard>

            <SummaryCard title="Randevu tercihleri" action={editLink("appointment", "Düzenle")}>
              <div className="flex flex-col gap-2.5 text-sm">
                {ctx.cities.length > 0 ? (
                  <p>
                    Randevu şehri:{" "}
                    {selectedCity ? (
                      <span className="font-semibold">{cityOptionLabel(selectedCity.name, selectedCity.surchargeAmount, selectedCity.surchargeCurrency)}</span>
                    ) : (
                      <span className="text-dash-ink-4">seçilmedi</span>
                    )}
                  </p>
                ) : null}
                {ctx.appointmentOutsideWindow ? <p>Sunulan tarihlerin size uymadığını belirttiniz; uygun olduğunuz günler:</p> : null}
                {ctx.preferences.length === 0 ? (
                  <p className="text-dash-ink-4">Tercih seçilmedi.</p>
                ) : (
                  <ol className="flex flex-col gap-1.5">
                    {ctx.preferences.map((p) => (
                      <li key={p.rank}>
                        <span className="font-bold">{p.rank}.</span> <span className="font-semibold">{formatDateLongTr(p.date)}</span>,{" "}
                        {APPOINTMENT_SLOT_LABELS[p.slot]}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </SummaryCard>

            <SummaryCard title="Ücret" action={editLink("fee", "Ayrıntı")}>
              <p className="text-sm leading-[1.6] text-dash-ink-2">
                Ücret, danışmanımızla ayrıca kararlaştırılır. Banka bilgilerini ve isteğe bağlı dekont yükleme alanını Ücret adımında
                bulabilirsiniz.
              </p>
            </SummaryCard>
          </>
        ) : null}

        <h2 className="mt-5 pl-1 text-xl font-extrabold tracking-[-0.01em]">Başvuru formu</h2>
        <FormAnswers
          formData={ctx.formData}
          look="wizard"
          sectionAction={canEditForm ? (sectionId) => editLink(`form/${sectionId}`, "Düzenle") : undefined}
          sectionNotice={
            isDraft
              ? (sectionId) => {
                  const count = ctx.formValidation.sections[sectionId].errorCount;
                  return count > 0 ? (
                    <StatusPill tone="warning" className="self-start">
                      Bu bölümde {count} eksik veya hatalı alan var.
                    </StatusPill>
                  ) : null;
                }
              : undefined
          }
        />

        {isDraft ? (
          <section className="mt-3 flex flex-col gap-5 rounded-[28px] border border-dash-line-soft bg-white px-5 py-8 sm:px-11">
            <h2 className="text-xl font-extrabold tracking-[-0.01em]">Başvuruyu gönder</h2>
            <SubmitApplication applicationId={id} blocked={ctx.issues.length > 0} />
          </section>
        ) : (
          <div className="mt-3">
            <WizLinkButton href={customerApplicationPath(id)} variant="secondary">
              Başvuru durumuna dön
            </WizLinkButton>
          </div>
        )}
      </div>
    </>
  );
}

export default function SummaryPage({ params }: PageProps<"/panel/applications/[id]/summary">) {
  return (
    <WizardShell>
      <Suspense fallback={<WizardLoading lines={6} />}>
        <Content params={params} />
      </Suspense>
    </WizardShell>
  );
}
