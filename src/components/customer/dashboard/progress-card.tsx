"use client";

import Link from "next/link";
import { Check, Clock, ExternalLink, MapPin, TriangleAlert, X } from "lucide-react";
import { VisaOutcomeDialog, type VisaOutcomeView } from "@/components/customer/visa-outcome-dialog";
import { cn } from "@/components/ui/primitives";
import { progressAlertText, type ApplicationProgress, type ProgressAlert, type ProgressStep, type ProgressStepState } from "@/features/applications/progress";

/** Circumference of the ring: 2π × 68. */
const RING_LENGTH = 427;

export type ApplicationCardItem = {
  id: string;
  href: string;
  referenceCode: string;
  /** Applicant's full name from the application form (null if not filled in). */
  applicantName: string | null;
  typeText: string;
  submittedText: string | null;
  progress: ApplicationProgress;
  result: VisaOutcomeView | null;
  cancelledText: string;
  /** Confirmed appointment (only in the "Randevu tarihi bildirildi" (appointment date sent) status). */
  appointment: {
    month: string;
    day: string;
    year: string;
    /** ", Cuma" */
    longDate: string;
    time: string;
    atText: string;
    location: string | null;
    address: string | null;
    /** Google Maps link the consultant entered in Settings (null if not entered; the button is hidden). */
    mapsUrl: string | null;
  } | null;
};

function Actions({ item, size = "lg" }: { item: ApplicationCardItem; size?: "lg" | "sm" }) {
  const base =
    size === "lg"
      ? "flex h-[52px] items-center rounded-full px-[26px] text-base font-extrabold"
      : "flex h-[42px] items-center rounded-full px-[18px] text-sm font-bold";
  return (
    <div className="flex flex-wrap gap-2.5">
      <Link href={item.href} className={cn(base, "bg-white text-dash-navy hover:bg-dash-subtle")}>
        Görüntüle
      </Link>
      {item.result ? <VisaOutcomeDialog result={item.result} triggerClassName={cn(base, "border-[1.5px] border-white/60 bg-transparent text-white hover:bg-white/10")} /> : null}
    </div>
  );
}

function metaText(item: ApplicationCardItem): string {
  return [item.typeText, item.submittedText ? `Gönderim: ${item.submittedText}` : ""].filter(Boolean).join(" · ");
}

// --- Large card (single application) ----------------------------------------------------------------------

const CIRCLE: Record<ProgressStepState, string> = {
  done: "bg-dash-green",
  current: "border-4 border-dash-red bg-dash-navy text-base font-extrabold shadow-[0_0_0_5px_color-mix(in_srgb,var(--color-dash-red)_25%,transparent)]",
  attention: "border-4 border-dash-red bg-dash-navy text-base font-extrabold shadow-[0_0_0_5px_color-mix(in_srgb,var(--color-dash-red)_25%,transparent)]",
  pending: "border-[1.5px] border-dash-ink-2 bg-dash-navy text-base font-bold text-dash-on-navy",
  cancelled: "bg-dash-red",
};
const LABEL: Record<ProgressStepState, string> = {
  done: "font-bold text-white",
  current: "font-extrabold text-white",
  attention: "font-extrabold text-white",
  pending: "font-semibold text-dash-ink-4",
  cancelled: "font-extrabold text-white",
};
const META: Record<ProgressStepState, string> = {
  done: "text-dash-green-soft",
  current: "text-dash-pink",
  attention: "text-dash-pink",
  pending: "text-dash-ink-3",
  cancelled: "text-dash-pink",
};
const STATE_TEXT: Record<ProgressStepState, string> = {
  done: "tamamlandı",
  current: "şu anki adım",
  attention: "sizden işlem bekleniyor",
  pending: "bekliyor",
  cancelled: "iptal edildi",
};

/** Step line: 7 columns on wide screens, a vertical list on narrow screens (below 900px). */
function StepLine({ steps }: { steps: ProgressStep[] }) {
  return (
    <ol className="flex flex-col pt-1 min-[900px]:grid min-[900px]:grid-cols-7 min-[900px]:text-center">
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        return (
          <li key={step.key} className="relative flex gap-4 pb-6 last:pb-0 min-[900px]:flex-col min-[900px]:items-center min-[900px]:gap-2.5 min-[900px]:px-1.5 min-[900px]:pb-0">
            {last ? null : (
              <span
                aria-hidden
                className={cn(
                  "absolute bottom-0 left-[24.5px] top-[52px] w-[3px] min-[900px]:bottom-auto min-[900px]:left-1/2 min-[900px]:right-[-50%] min-[900px]:top-[25px] min-[900px]:h-[3px] min-[900px]:w-auto",
                  step.state === "done" ? "bg-dash-green" : "bg-dash-navy-hover",
                )}
              />
            )}
            <span aria-hidden className={cn("relative grid size-[52px] flex-none place-items-center rounded-full", CIRCLE[step.state])}>
              {step.state === "done" ? (
                <Check className="size-[22px]" strokeWidth={3.5} />
              ) : step.state === "cancelled" ? (
                <X className="size-[22px]" strokeWidth={3.5} />
              ) : step.state === "attention" ? (
                "!"
              ) : (
                i + 1
              )}
            </span>
            <span className="flex flex-col gap-1 pt-2.5 min-[900px]:gap-2.5 min-[900px]:pt-0">
              <span className={cn("text-base leading-[1.3] [text-wrap:pretty] min-[900px]:text-[15px]", LABEL[step.state])}>
                <span className="sr-only">{i + 1}. adım: </span>
                {step.label}
              </span>
              <span className={cn("text-sm font-bold min-[900px]:-mt-1", META[step.state])}>
                <span className="sr-only">{STATE_TEXT[step.state]}, </span>
                {step.meta}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * "Sizden beklenenler" (what we need from you): every task expected from the customer (payment could not be verified,
 * extra document, form correction, task, new appointment preference) is listed one by one in a red-bordered box.
 */
function AlertList({ alerts, compact = false }: { alerts: ProgressAlert[]; compact?: boolean }) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col rounded-[20px] border-[1.5px] border-dash-red bg-[color-mix(in_srgb,var(--color-dash-red)_16%,transparent)]",
        compact ? "gap-2 p-3.5" : "gap-3 p-4 min-[900px]:p-5",
      )}
    >
      <p className="flex items-center gap-2 text-[13px] font-extrabold tracking-[0.08em] text-dash-pink">
        <TriangleAlert aria-hidden className="size-4" strokeWidth={2.75} />
        SİZDEN BEKLENENLER
      </p>
      <ul className={cn("flex flex-col", compact ? "gap-2" : "gap-3")}>
        {alerts.map((alert, i) => {
          const text = progressAlertText(alert);
          return (
            <li key={`${alert.kind}-${i}`} className="flex gap-3">
              <span aria-hidden className="mt-[2px] grid size-5 flex-none place-items-center rounded-full bg-dash-red text-xs font-extrabold text-white">
                !
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className={cn("font-bold text-white", compact ? "text-sm" : "text-base")}>{text.title}</span>
                <span className={cn("whitespace-pre-line leading-normal text-dash-on-navy [overflow-wrap:anywhere]", compact ? "text-[13px]" : "text-sm")}>{text.text}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Appointment strip: calendar box, date and time, a location block that opens in maps (only once the appointment is sent). */
function AppointmentBand({ appointment }: { appointment: NonNullable<ApplicationCardItem["appointment"]> }) {
  const place = appointment.location || appointment.address;
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 rounded-[24px] bg-dash-navy-strip p-4 min-[900px]:grid-cols-[auto_300px_1px_minmax(0,1fr)] min-[900px]:gap-x-7 min-[900px]:gap-y-0">
      <div aria-hidden className="w-[84px] flex-none overflow-hidden rounded-[16px] bg-white text-center text-dash-navy">
        <div className="bg-dash-red py-[5px] text-[11px] font-extrabold uppercase tracking-[0.12em] text-white">{appointment.month.toLocaleUpperCase("tr-TR")}</div>
        <div className="pb-0.5 pt-2 text-[36px] font-extrabold leading-none tracking-[-0.02em]">{appointment.day}</div>
        <div className="pb-2 text-[11px] font-bold text-dash-ink-2">{appointment.year}</div>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-xs font-extrabold tracking-[0.1em] text-dash-ink-4">RANDEVU</span>
        <span className="text-[19px] font-extrabold tracking-[-0.01em] min-[900px]:text-[22px]">{appointment.longDate}</span>
        <span className="flex flex-wrap items-center gap-2 text-base font-bold text-white">
          <Clock aria-hidden className="size-4 text-dash-pink" strokeWidth={2.75} />
          {appointment.time}
          <span className="font-semibold text-dash-ink-4">Türkiye saati</span>
        </span>
      </div>
      {place ? (
        <>
          <span aria-hidden className="col-span-2 h-px bg-dash-navy-divider min-[900px]:col-span-1 min-[900px]:my-1.5 min-[900px]:h-auto min-[900px]:w-px min-[900px]:self-stretch" />
          {appointment.mapsUrl ? (
            <a
              href={appointment.mapsUrl}
              target="_blank"
              rel="noopener"
              className="col-span-2 flex min-w-0 flex-wrap items-center gap-[18px] rounded-[18px] py-3 pl-4 pr-3.5 text-white no-underline transition-colors hover:bg-dash-navy-hover hover:text-white focus-visible:outline-dash-pink min-[900px]:col-span-1 min-[900px]:flex-nowrap motion-reduce:transition-none"
            >
              <PlaceText appointment={appointment} />
              <span className="flex h-10 flex-none items-center gap-1.5 rounded-full bg-white px-4 text-sm font-extrabold text-dash-navy">
                Haritada aç
                <ExternalLink aria-hidden className="size-3.5" strokeWidth={2.75} />
                <span className="sr-only"> (yeni sekmede açılır)</span>
              </span>
            </a>
          ) : (
            <div className="col-span-2 flex min-w-0 items-center gap-[18px] py-3 pl-4 pr-3.5 min-[900px]:col-span-1">
              <PlaceText appointment={appointment} />
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function PlaceText({ appointment }: { appointment: NonNullable<ApplicationCardItem["appointment"]> }) {
  return (
    <>
      <span aria-hidden className="grid size-12 flex-none place-items-center rounded-full bg-dash-red">
        <MapPin className="size-[22px] text-white" strokeWidth={2.75} />
      </span>
      <span className="mr-auto flex min-w-0 flex-[1_1_200px] flex-col gap-1">
        <span className="text-xs font-extrabold tracking-[0.1em] text-dash-ink-4">YER</span>
        {appointment.location ? <span className="text-lg font-extrabold">{appointment.location}</span> : null}
        {appointment.address ? (
          <span className="whitespace-pre-line text-sm leading-[1.45] text-dash-on-navy underline decoration-dash-ink-2 underline-offset-[3px] [text-wrap:pretty]">
            {appointment.address}
          </span>
        ) : null}
      </span>
    </>
  );
}

/**
 * Large status card of a single application. Step label, title,
 * description, ring and step line are all derived from the same "current step" value.
 */
function SingleApplication({ item }: { item: ApplicationCardItem }) {
  const progress = item.progress;
  const cancelled = progress.kind === "cancelled";
  const steps = progress.steps;
  const total = steps.length;
  const index = progress.currentIndex ?? total - 1;
  const step = steps[index]!;
  const stepNumber = index + 1;
  // The ring shows the current step (the 5/6 example in the design); when cancelled, the steps completed before cancelling are filled.
  const filled = cancelled ? index : stepNumber;
  // If something is expected from the customer the ring is red with an exclamation mark instead of the step number.
  const attention = progress.alerts.length > 0;
  const eyebrow = cancelled ? "İPTAL EDİLDİ" : attention ? `${stepNumber}. ADIM · İŞLEM GEREKLİ` : `${stepNumber}. ADIM`;
  const ringLabel = cancelled
    ? `Başvuru ${stepNumber}. adımda iptal edildi`
    : attention
      ? `Sizden işlem bekleniyor. ${total} adımın ${stepNumber}. adımındasınız`
      : `${total} adımın ${stepNumber}. adımındasınız`;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-6 min-[900px]:flex-row min-[900px]:items-center min-[900px]:gap-10">
        <div className="flex min-w-0 flex-col gap-3 min-[900px]:mr-auto">
          <p className="text-[15px] text-dash-on-navy">
            Gönderilen başvuru · <strong className="font-bold text-white">{item.referenceCode}</strong>
            {item.applicantName ? ` · ${item.applicantName}` : ""}
            {metaText(item) ? ` · ${metaText(item)}` : ""}
          </p>
          <span className="mt-1.5 text-[13px] font-extrabold tracking-[0.08em] text-dash-pink">{eyebrow}</span>
          <h2 className="font-dash text-[30px] font-extrabold leading-[1.1] tracking-[-0.02em] min-[900px]:text-[40px]">
            {cancelled ? "Başvurunuz iptal edildi" : step.title}
          </h2>
          <p className="max-w-[640px] text-[17px] leading-normal text-dash-on-navy">{cancelled ? item.cancelledText : step.description}</p>
          <div className="mt-2.5">
            <Actions item={item} />
          </div>
        </div>
        <div
          className="relative order-first size-[120px] flex-none min-[900px]:order-none min-[900px]:size-40"
          role="img"
          aria-label={ringLabel}
        >
          <svg viewBox="0 0 160 160" className="size-full -rotate-90" aria-hidden>
            <circle cx="80" cy="80" r="68" fill="none" stroke="var(--color-dash-navy-hover)" strokeWidth="14" />
            <circle
              cx="80"
              cy="80"
              r="68"
              fill="none"
              stroke={cancelled || attention ? "var(--color-dash-red)" : "var(--color-dash-green)"}
              strokeWidth="14"
              strokeLinecap="round"
              strokeDasharray={`${Math.round((RING_LENGTH * filled) / total)} ${RING_LENGTH + 1}`}
            />
          </svg>
          <div aria-hidden className="absolute inset-0 flex flex-col items-center justify-center gap-1">
            {/* The cross when cancelled and the exclamation mark when something is expected from the customer sit right in the middle of the ring; no text below. */}
            {cancelled ? (
              <span className="grid size-14 place-items-center rounded-full bg-dash-red min-[900px]:size-[72px]">
                <X className="size-7 min-[900px]:size-9" strokeWidth={3.5} />
              </span>
            ) : attention ? (
              <span className="grid size-14 place-items-center rounded-full bg-dash-red font-dash text-[32px] font-extrabold leading-none min-[900px]:size-[72px] min-[900px]:text-[40px]">
                !
              </span>
            ) : (
              <>
                <span className="font-dash text-[32px] font-extrabold leading-none tracking-[-0.02em] min-[900px]:text-[42px]">
                  {stepNumber}
                  <span className="text-base text-dash-on-navy min-[900px]:text-xl">/{total}</span>
                </span>
                <span className="text-sm text-dash-on-navy">adım</span>
              </>
            )}
          </div>
        </div>
      </div>

      {attention && !cancelled ? <AlertList alerts={progress.alerts} /> : null}

      {item.appointment && !cancelled ? <AppointmentBand appointment={item.appointment} /> : null}

      <StepLine steps={steps} />
    </div>
  );
}

// --- Compact view (several applications) ------------------------------------------------------------------

const SMALL_RING: Record<ProgressStepState, string> = {
  done: "border-2 border-dash-green bg-dash-green text-white",
  current: "border-[3px] border-dash-red bg-dash-navy text-white",
  attention: "border-[3px] border-dash-red bg-dash-red text-white",
  pending: "border-2 border-white/30 bg-dash-navy text-white/60",
  cancelled: "border-2 border-dash-red bg-dash-red text-white",
};

/** Compact step row: scrolls horizontally on narrow screens. */
function SmallStepString({ steps, currentIndex }: { steps: ProgressStep[]; currentIndex: number | null }) {
  const reached = currentIndex ?? steps.length;
  return (
    <div className="-mx-2 overflow-x-auto px-2 pb-1">
      <ol className="grid min-w-[630px] grid-cols-7">
        {steps.map((step, i) => (
          <li key={step.key} className="relative flex flex-col items-center gap-2.5 px-1.5 text-center">
            {i > 0 ? <span aria-hidden className={cn("absolute left-0 right-1/2 top-[14.5px] h-[3px]", i <= reached ? "bg-dash-green" : "bg-white/[0.18]")} /> : null}
            {i < steps.length - 1 ? (
              <span aria-hidden className={cn("absolute left-1/2 right-0 top-[14.5px] h-[3px]", i < reached && step.state === "done" ? "bg-dash-green" : "bg-white/[0.18]")} />
            ) : null}
            <span role="img" aria-label={`${i + 1}. adım: ${step.label} — ${step.meta}`} className={cn("relative z-[1] flex size-8 flex-none items-center justify-center rounded-full text-[13px] font-bold", SMALL_RING[step.state])}>
              {step.state === "done" ? (
                <Check aria-hidden className="size-[15px]" strokeWidth={3.5} />
              ) : step.state === "cancelled" ? (
                <X aria-hidden className="size-[15px]" strokeWidth={3.5} />
              ) : step.state === "attention" ? (
                <span aria-hidden className="font-extrabold">
                  !
                </span>
              ) : (
                i + 1
              )}
            </span>
            <span className={cn("text-xs leading-[1.3] [text-wrap:pretty]", step.state === "pending" ? "font-semibold text-white/60" : "font-semibold text-white")}>{step.label}</span>
            <span className={cn("text-[11px] font-bold", META[step.state])}>{step.meta}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Small appointment strip inside the card (several-applications view). */
function AppointmentStrip({ appointment }: { appointment: NonNullable<ApplicationCardItem["appointment"]> }) {
  return (
    <div className="flex items-center gap-3 self-start rounded-[18px] bg-white/[0.08] py-2 pl-2 pr-4">
      <div aria-hidden className="flex h-12 w-11 flex-none flex-col items-center justify-center gap-0.5 rounded-[14px] bg-white text-dash-navy">
        <span className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-dash-red">{appointment.month}</span>
        <span className="text-lg font-extrabold leading-none">{appointment.day}</span>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-dash-on-navy">Randevu tarihiniz</span>
        <span className="text-sm font-bold text-white">{appointment.atText}</span>
        {appointment.location ? <span className="text-[13px] text-dash-on-navy">Yer: {appointment.location}</span> : null}
      </div>
    </div>
  );
}

function CompactApplication({ item }: { item: ApplicationCardItem }) {
  const progress = item.progress;
  const currentStep = progress.kind === "active" && progress.currentIndex !== null ? progress.steps[progress.currentIndex] : null;
  const status =
    progress.kind === "cancelled"
      ? "Başvurunuz iptal edildi"
      : currentStep
        ? `Şu anki adım: ${currentStep.title} (${progress.currentIndex! + 1}/${progress.steps.length})`
        : "Tüm adımlar tamamlandı";

  return (
    <section aria-label={`${item.referenceCode} başvurusu`} className="flex flex-col gap-5 border-t border-white/10 pt-6 first-of-type:border-t-0 first-of-type:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-base font-bold">
            {item.referenceCode}
            {item.applicantName ? <span className="font-semibold text-dash-on-navy"> · {item.applicantName}</span> : null}
          </h3>
          {metaText(item) ? <p className="text-[13px] text-dash-on-navy">{metaText(item)}</p> : null}
          <p className="text-[13px] font-bold text-dash-pink">{status}</p>
          {/* What to do at the step with the exclamation mark is written in the "Sizden beklenenler" box below; the description is not repeated. */}
          {currentStep && currentStep.state !== "attention" ? (
            <p className="max-w-[560px] text-[13px] leading-normal text-dash-on-navy">{currentStep.description}</p>
          ) : null}
          {item.appointment && progress.kind === "active" ? (
            <div className="mt-1.5">
              <AppointmentStrip appointment={item.appointment} />
            </div>
          ) : null}
        </div>
        <Actions item={item} size="sm" />
      </div>
      {progress.alerts.length > 0 ? <AlertList alerts={progress.alerts} compact /> : null}
      <SmallStepString steps={progress.steps} currentIndex={progress.currentIndex} />
    </section>
  );
}

/**
 * Navy card of submitted applications. A large status card for a single application;
 * for several applications, a compact step row for each inside one card.
 */
export function ApplicationsCard({ items }: { items: ApplicationCardItem[] }) {
  if (items.length === 0) return null;
  const single = items.length === 1;
  return (
    <section
      aria-label={single ? `${items[0]!.referenceCode} başvurusu` : "Gönderilen başvurularınız"}
      className={cn(
        "flex w-full flex-col bg-dash-navy text-white",
        single
          ? "gap-8 rounded-[24px] px-6 py-7 min-[900px]:rounded-[32px] min-[900px]:px-12 min-[900px]:pb-9 min-[900px]:pt-10"
          : "gap-6 rounded-[30px] px-5 py-[30px] sm:px-8",
      )}
    >
      {single ? (
        <SingleApplication item={items[0]!} />
      ) : (
        <>
          <h2 className="font-dash text-[22px] font-extrabold tracking-[-0.02em]">Gönderilen başvurularınız</h2>
          {items.map((item) => (
            <CompactApplication key={item.id} item={item} />
          ))}
        </>
      )}
    </section>
  );
}
