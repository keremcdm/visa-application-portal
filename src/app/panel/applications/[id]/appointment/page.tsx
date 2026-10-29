import type { Metadata } from "next";
import { cityOptionLabel, surchargeText } from "@/features/pricing/surcharge";
import { Suspense } from "react";
import { AppointmentForm } from "@/components/customer/appointment-form";
import { WizardHeader, WizardShell } from "@/components/customer/wizard/shell";
import { WizardBody, WizardCard, WizardLoading, WizChip, WizNote } from "@/components/customer/wizard/ui";
import { appointmentStatusTone } from "@/components/status-badges";
import { alternativeDates, selectableDates } from "@/features/appointments/window";
import { APPOINTMENT_SLOT_LABELS, APPOINTMENT_STATUS_LABELS } from "@/lib/domain/constants";
import { customerApplicationPath } from "@/lib/site";
import { formatDateLongTr, formatDateTimeTr } from "@/lib/validation/formats";
import { loadApplicationContext } from "@/server/data/customer";

export const metadata: Metadata = { title: "Randevu tercihi" };

async function Content({ params }: Pick<PageProps<"/panel/applications/[id]/appointment">, "params">) {
  const { id } = await params;
  const ctx = await loadApplicationContext(id);
  const { application } = ctx;
  const isDraft = application.status === "draft";
  const editable = isDraft || application.appointmentStatus === "preferences_requested";
  const dates = selectableDates(ctx.today, ctx.appointmentConfig).map((date) => ({ date, label: formatDateLongTr(date) }));
  const laterDates = alternativeDates(ctx.today, ctx.appointmentConfig).map((date) => ({ date, label: formatDateLongTr(date) }));
  const city = ctx.cities.find((c) => c.id === application.cityId);
  const cityName = city ? cityOptionLabel(city.name, city.surchargeAmount, city.surchargeCurrency) : null;

  // Notes above the card (confirmed appointment, info, request for new preferences); shown at the top of the form while editable.
  const notes = (
    <>
      {application.appointmentAt && (application.appointmentStatus === "scheduled" || application.appointmentStatus === "completed") ? (
        <WizNote tone="success" title="Randevu tarihiniz" role="status">
          <p className="text-base font-bold">{formatDateTimeTr(application.appointmentAt)}</p>
          {application.appointmentLocation ? <p className="mt-1">Yer: {application.appointmentLocation}</p> : null}
          {application.appointmentAddress ? <p className="whitespace-pre-line">Adres: {application.appointmentAddress}</p> : null}
          {application.appointmentNote ? <p className="mt-1 whitespace-pre-line">{application.appointmentNote}</p> : null}
        </WizNote>
      ) : null}

      <WizNote tone="info">
        Burada bildirdiğiniz tercihler kesin randevu değildir. Danışmanınız, tercihlerinizi dikkate alarak vize başvuru merkezinden
        randevu almaya çalışır ve kesinleşen tarihi size ayrıca bildirir.
      </WizNote>

      {editable && application.appointmentStatus === "preferences_requested" ? (
        <WizNote tone="warning" title="Yeni tercih bekleniyor">
          Danışmanınız sizden yeni randevu tercihleri bildirmenizi istedi.
        </WizNote>
      ) : null}
    </>
  );

  return (
    <>
      <WizardHeader application={application} current="appointment" steps={ctx.steps} />
      <WizardCard
        eyebrow={isDraft ? "Adım 4 / 6" : undefined}
        title="Randevu tercihi"
        // so the description is not split in the middle of the page and is full width like the note below.
        wideDescription
        titleExtra={!isDraft ? <WizChip tone={appointmentStatusTone(application.appointmentStatus)}>{APPOINTMENT_STATUS_LABELS[application.appointmentStatus]}</WizChip> : null}
        description={
          editable ? (
            <p>
              {isDraft && ctx.cities.length > 0 ? "Randevu şehrinizi seçiniz; ardından takvimde önümüzdeki" : "Takvimde önümüzdeki"} günlerden{" "}
              <strong className="font-bold text-dash-navy">en az bir, en fazla üç gün</strong> seçiniz ve her gün için tüm gün, öğleden önce veya öğleden
              sonra belirtiniz. Seçim sıranız tercih sıranızdır. Bu tarihlerin hiçbiri size uymuyorsa takvimin altındaki kutuyu işaretleyiniz.
            </p>
          ) : null
        }
      >
        {editable ? (
          <AppointmentForm
            applicationId={id}
            dates={dates}
            alternativeDates={laterDates}
            initial={ctx.preferences.map((p) => ({ date: p.date, slot: p.slot }))}
            initialOutsideWindow={ctx.appointmentOutsideWindow}
            // The appointment city can only be changed in a draft.
            cities={
              isDraft
                ? ctx.cities.map((c) => ({
                    id: c.id,
                    label: cityOptionLabel(c.name, c.surchargeAmount, c.surchargeCurrency),
                    hasSurcharge: surchargeText(c.surchargeAmount, c.surchargeCurrency) !== null,
                  }))
                : []
            }
            initialCityId={application.cityId}
            nextHref={isDraft ? customerApplicationPath(id, "fee") : null}
            backHref={isDraft ? customerApplicationPath(id, "documents") : null}
            saveLabel={isDraft ? "Kaydet ve devam et" : "Tercihleri gönder"}
            intro={
              <>
                {notes}
                {!isDraft && cityName ? <p className="text-[15px]">Randevu şehri: {cityName}</p> : null}
              </>
            }
          />
        ) : (
          <WizardBody>
            {notes}
            <div>
              <h2 className="text-base font-bold">Bildirdiğiniz tercihler</h2>
              {cityName ? <p className="mt-2 text-[15px]">Randevu şehri: {cityName}</p> : null}
              {ctx.appointmentOutsideWindow ? (
                <p className="mt-2 text-[15px]">Sunulan tarihlerin size uymadığını belirttiniz; uygun olduğunuz günler:</p>
              ) : null}
              {ctx.preferences.length === 0 ? (
                <p className="mt-2 text-sm text-dash-ink-3">Tercih bildirilmemiş.</p>
              ) : (
                <ol className="mt-3 space-y-1.5 text-[15px]">
                  {ctx.preferences.map((p) => (
                    <li key={p.rank}>
                      <span className="font-bold">{p.rank}.</span> {formatDateLongTr(p.date)}, {APPOINTMENT_SLOT_LABELS[p.slot]}
                    </li>
                  ))}
                </ol>
              )}
              <p className="mt-4 text-sm text-dash-ink-3">
                Tercihleriniz danışmanınıza iletildi. Değişiklik gerekirse danışmanınız sizden yeni tercih isteyecektir.
              </p>
            </div>
          </WizardBody>
        )}
      </WizardCard>
    </>
  );
}

export default function AppointmentPage({ params }: PageProps<"/panel/applications/[id]/appointment">) {
  return (
    <WizardShell>
      <Suspense fallback={<WizardLoading />}>
        <Content params={params} />
      </Suspense>
    </WizardShell>
  );
}
