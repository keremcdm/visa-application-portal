import Link from "next/link";
import type { ReactNode } from "react";
import { Ban, CalendarDays, Check, ClipboardCheck, Clock, CreditCard, Download, ExternalLink, FileText, FileUp, MapPin, PenLine, X } from "lucide-react";
import { BankTransferInfo } from "@/components/customer/bank-transfer-info";
import { VisaOutcomeDialog, type VisaOutcomeView } from "@/components/customer/visa-outcome-dialog";
import { WizardHeader } from "@/components/customer/wizard/shell";
import { StatusPill, wizButtonClass, type PillTone } from "@/components/customer/wizard/ui";
import { FileRow, FileUploadButton, type FileItem } from "@/components/documents/file-upload";
import { ActionButton } from "@/components/ui/action-button";
import { cn } from "@/components/ui/primitives";
import type { CustomerTodo } from "@/features/applications/customer-todos";
import { PROGRESS_STEP_NAMES, type ApplicationProgress, type ProgressStep } from "@/features/applications/progress";
import { canCustomerDeclarePayment } from "@/features/applications/submission";
import { appointmentLeaf, appointmentMapsLink } from "@/features/appointments/calendar";
import { APPOINTMENT_STATUS_LABELS, PAYMENT_STATUS_LABELS, VISA_OUTCOME_LABELS, type AppointmentStatus, type PaymentStatus } from "@/lib/domain/constants";
import { customerApplicationPath, customerDocumentPath } from "@/lib/site";
import { formatDateTimeTr } from "@/lib/validation/formats";
import { completeTaskAction, declarePaymentAction } from "@/server/actions/applications";
import type { StepState, WizardStepId } from "@/server/data/customer";
import type { Application, PaymentInfo } from "@/server/data/types";
import { FinishFormCorrectionButton } from "../form-edit-controls";
import { MessagesCard, type StatusMessage } from "./messages-card";

/*
 * APPLICATION STATUS PAGE VIEW
 * two columns; on the left (result / cancellation),
 * what you need to do, messages, (confirmed appointment) and payment; on the right the status timeline and appointment
 * preferences. Reads no data; the page prepares it. Texts, fields and rules are the same as on the old page.
 * For a cancelled application only the cancellation notice, messages and a faded timeline are shown.
 */

export type StatusViewProps = {
  application: Application;
  steps: Record<WizardStepId, StepState>;
  /** If the application was just submitted ("?submitted=1"). */
  justSubmitted: boolean;
  /** Explanation of the application status for the customer (APPLICATION_STATUS_CUSTOMER_HINTS). */
  statusHint: string;
  progress: ApplicationProgress;
  todos: readonly CustomerTodo[];
  messages: readonly StatusMessage[];
  payment: PaymentInfo;
  receipts: readonly FileItem[];
  maxUploadBytes: number;
  /** Appointment letter uploaded by the consultant; shown on the appointment card. */
  appointmentLetter: { id: string; originalName: string } | null;
  preferences: readonly { rank: number; dateText: string; slotText: string }[];
  /** Only in the "Sonuç müşteriye bildirildi" (result sent to customer) status. */
  result: VisaOutcomeView | null;
};

const card = "rounded-[24px] border border-dash-line-soft bg-white";
const cardTitle = "text-[17px] font-extrabold";

// --- What you need to do -------------------------------------------------------

const DOCUMENT_REASON_TEXT = { needs_correction: "düzeltme gerekiyor.", missing: "eksik.", awaiting_upload: "yüklenmesi bekleniyor." } as const;

function TodoRow({ icon, title, description, action }: { icon: ReactNode; title: ReactNode; description?: ReactNode; action: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3.5 border-t border-dash-line-soft py-3.5">
      <span aria-hidden className="flex size-10 flex-none items-center justify-center rounded-full bg-dash-red-tint text-dash-red">
        {icon}
      </span>
      <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-[3px]">
        <p className="text-[15px]">{title}</p>
        {description ? <p className="whitespace-pre-line text-[13px] leading-normal text-dash-ink-2">{description}</p> : null}
      </div>
      <div className="flex-none">{action}</div>
    </li>
  );
}

function TodoCard({ applicationId, todos }: { applicationId: string; todos: readonly CustomerTodo[] }) {
  const action = wizButtonClass("primary", "row");
  const iconClass = "size-[18px]";
  return (
    <section
      aria-labelledby="todos-heading"
      className={cn("flex flex-col rounded-[24px] border-[1.5px] bg-white px-5 pb-3.5 pt-6 sm:px-7", todos.length > 0 ? "border-dash-red-border" : "border-dash-line-soft")}
    >
      <div className="flex items-center gap-2.5 pb-2">
        <h2 id="todos-heading" className={cardTitle}>
          Yapmanız gerekenler
        </h2>
        {todos.length > 0 ? (
          <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-dash-red px-[7px] text-xs font-extrabold text-white">
            {todos.length}
            <span className="sr-only"> madde</span>
          </span>
        ) : null}
      </div>
      {todos.length === 0 ? (
        <div className="mb-2.5 flex items-center gap-3 rounded-[18px] bg-dash-canvas px-4 py-3.5">
          <span aria-hidden className="flex size-[30px] flex-none items-center justify-center rounded-full bg-dash-green text-white">
            <Check className="size-3.5" strokeWidth={3.5} />
          </span>
          <p className="text-sm text-dash-ink-2">Şu anda sizden beklenen bir işlem yok. Bir işlem gerektiğinde burada göreceksiniz.</p>
        </div>
      ) : (
        <ul>
          {todos.map((todo) => {
            switch (todo.kind) {
              case "payment":
                return (
                  <TodoRow
                    key="payment"
                    icon={<CreditCard className={iconClass} strokeWidth={2.5} />}
                    title={<span className="font-bold">Ödemenizi yapıp bildiriniz.</span>}
                    action={
                      <a href="#payment" className={action}>
                        Ödeme bilgilerine git
                      </a>
                    }
                  />
                );
              case "document":
                return (
                  <TodoRow
                    key={todo.slotId}
                    icon={<FileUp className={iconClass} strokeWidth={2.5} />}
                    title={
                      <>
                        <span className="font-bold">{todo.label}:</span> {DOCUMENT_REASON_TEXT[todo.reason]}
                      </>
                    }
                    description={todo.note}
                    action={
                      <Link href={customerDocumentPath(applicationId, todo.slotId)} className={action}>
                        Evraklara git
                      </Link>
                    }
                  />
                );
              case "form":
                return (
                  <TodoRow
                    key="form"
                    icon={<PenLine className={iconClass} strokeWidth={2.5} />}
                    title={<span className="font-bold">Başvuru formunuzda düzeltme bekleniyor.</span>}
                    description="Formu düzenledikten sonra “Formu düzenlemeyi tamamladım” düğmesine basınız."
                    action={
                      <div className="flex flex-wrap items-start gap-2">
                        <Link href={customerApplicationPath(applicationId, "summary")} className={wizButtonClass("secondary", "row")}>
                          Formu düzenle
                        </Link>
                        <FinishFormCorrectionButton applicationId={applicationId} size="row" />
                      </div>
                    }
                  />
                );
              case "appointment":
                return (
                  <TodoRow
                    key="appointment"
                    icon={<CalendarDays className={iconClass} strokeWidth={2.5} />}
                    title={<span className="font-bold">Yeni randevu tercihleri bildirmeniz bekleniyor.</span>}
                    action={
                      <Link href={customerApplicationPath(applicationId, "appointment")} className={action}>
                        Tercih bildir
                      </Link>
                    }
                  />
                );
              case "task":
                return (
                  <TodoRow
                    key={todo.id}
                    icon={<ClipboardCheck className={iconClass} strokeWidth={2.5} />}
                    title={<span className="font-bold">{todo.title}</span>}
                    description={todo.description || null}
                    action={
                      <ActionButton buttonClassName={action} feedbackClassName="text-xs" action={completeTaskAction.bind(null, applicationId, todo.id)}>
                        Tamamladım
                      </ActionButton>
                    }
                  />
                );
            }
          })}
        </ul>
      )}
    </section>
  );
}

// --- Payment -------------------------------------------------------------------

const PAYMENT_PILLS: Record<PaymentStatus, { tone: PillTone; icon?: "clock" | "x" | "check" }> = {
  not_due: { tone: "neutral" },
  awaiting_payment: { tone: "waiting" },
  under_review: { tone: "info", icon: "clock" },
  verified: { tone: "done" },
  rejected: { tone: "danger", icon: "x" },
};

function PaymentLine({ icon, tone, children }: { icon: ReactNode; tone: "green" | "navy"; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3.5">
      <span
        aria-hidden
        className={cn("flex size-10 flex-none items-center justify-center rounded-full", tone === "green" ? "bg-dash-green text-white" : "bg-dash-navy-tint text-dash-navy")}
      >
        {icon}
      </span>
      <p className="flex-[1_1_240px] text-sm leading-[1.55] text-dash-ink-2">{children}</p>
    </div>
  );
}

function PaymentCard(props: Pick<StatusViewProps, "application" | "payment" | "receipts" | "maxUploadBytes">) {
  const { application, payment, receipts, maxUploadBytes } = props;
  const status = application.paymentStatus;
  const verified = status === "verified";
  const due = status === "awaiting_payment" || status === "rejected";
  const rule = canCustomerDeclarePayment(status);
  const pill = PAYMENT_PILLS[status];

  const receiptsBlock =
    payment.receiptUploadEnabled || receipts.length > 0 ? (
      <div className="flex flex-col gap-2.5">
        <h3 className="text-[15px] font-bold">Banka dekontu</h3>
        {receipts.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {receipts.map((file) => (
              <FileRow key={file.id} applicationId={application.id} canDelete={!verified} look="wizard" file={file} />
            ))}
          </ul>
        ) : null}
        {payment.receiptUploadEnabled && !verified ? (
          <FileUploadButton applicationId={application.id} target={{ kind: "payment_receipt" }} label="Dekont yükle" maxBytes={maxUploadBytes} look="inline" />
        ) : null}
      </div>
    ) : null;

  return (
    <section id="payment" aria-labelledby="payment-heading" className={cn(card, "flex scroll-mt-6 flex-col gap-5 p-5 sm:p-7")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="payment-heading" className={cardTitle}>
          Ödeme
        </h2>
        <StatusPill tone={pill.tone} icon={pill.icon} size="sm">
          {PAYMENT_STATUS_LABELS[status]}
        </StatusPill>
      </div>

      {status === "rejected" && application.paymentNote ? (
        <div className="flex flex-col gap-1.5 rounded-[18px] bg-dash-red-tint px-[18px] py-4">
          <p className="text-[13px] font-extrabold text-dash-red-hover">Ödemeniz doğrulanamadı</p>
          <p className="whitespace-pre-line text-sm leading-[1.55]">{application.paymentNote}</p>
        </div>
      ) : null}

      {verified ? (
        // once the payment is verified, a single line instead of the bank details.
        <>
          <PaymentLine tone="green" icon={<Check className="size-[18px]" strokeWidth={3.5} />}>
            Ödemeniz danışmanlarımız tarafından doğrulandı.
          </PaymentLine>
          {receiptsBlock ? <div className="border-t border-dash-line-soft pt-5">{receiptsBlock}</div> : null}
        </>
      ) : status === "under_review" ? (
        // Notice received: the single line from the design. Receipt upload (if enabled) stays because it helps the consultant check.
        <>
          <div role="status">
            <PaymentLine tone="navy" icon={<Clock className="size-[18px]" strokeWidth={2.75} />}>
              Ödeme bildiriminiz alındı. Danışmanlarımız banka hesabını kontrol ettikten sonra ödemeniz doğrulanacaktır.
            </PaymentLine>
          </div>
          {receiptsBlock ? <div className="border-t border-dash-line-soft pt-5">{receiptsBlock}</div> : null}
        </>
      ) : (
        <>
          <p className="text-sm leading-[1.6] text-dash-ink-2">Danışmanımızla anlaştığınız ücreti aşağıdaki hesaba banka havalesiyle ödeyebilirsiniz.</p>
          <div className="flex flex-wrap items-stretch gap-5">
            <div className="min-w-0 flex-[1_1_380px] rounded-[22px] bg-dash-canvas p-5 sm:p-6">
              <BankTransferInfo payment={payment} look="status" />
            </div>
            <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-5">
              {due ? (
                <div className="flex flex-col items-start gap-3">
                  <p className="text-sm leading-[1.6] text-dash-ink-2">
                    Havaleyi yaptıktan sonra aşağıdaki düğmeyle bize bildiriniz. Bildiriminiz ödemenin doğrulandığı anlamına gelmez; ödeme,
                    danışmanlarımız hesabı kontrol ettikten sonra doğrulanır.
                  </p>
                  <ActionButton
                    buttonClassName={wizButtonClass("primary", "lg")}
                    action={declarePaymentAction.bind(null, application.id)}
                    disabled={!rule.ok}
                    confirm={{
                      title: "Ödemeyi yaptığınızı bildiriyor musunuz?",
                      description:
                        "Bu bildirimle danışmanlarımız banka hesabını kontrol edecektir. Lütfen yalnızca havaleyi gerçekten yaptıysanız onaylayınız.",
                      confirmLabel: "Evet, ödemeyi yaptım",
                    }}
                  >
                    Ödemeyi yaptım
                  </ActionButton>
                </div>
              ) : null}
              {receiptsBlock ? <div className={cn(due && "border-t border-dash-line-soft pt-5")}>{receiptsBlock}</div> : null}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

// --- Result and cancellation ---------------------------------------------------

function ResultCard({ result }: { result: VisaOutcomeView }) {
  const approved = result.outcome === "approved";
  return (
    <section aria-labelledby="outcome-heading" className="flex flex-wrap items-center gap-5 rounded-[28px] bg-dash-navy px-6 py-7 text-white sm:px-8">
      <span aria-hidden className={cn("flex size-[52px] flex-none items-center justify-center rounded-full text-white", approved ? "bg-dash-green" : "bg-dash-red")}>
        {approved ? <Check className="size-[22px]" strokeWidth={3.5} /> : <X className="size-5" strokeWidth={3.5} />}
      </span>
      <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-1">
        <h2 id="outcome-heading" className="text-xs font-bold uppercase tracking-[0.08em] text-dash-on-navy">
          Vize başvurunuzun sonucu · {result.atText}
        </h2>
        <p className="text-2xl font-extrabold tracking-[-0.01em]">{VISA_OUTCOME_LABELS[result.outcome]}</p>
        <p className="text-[13px] leading-normal text-dash-on-navy">Danışmanınız yetkili makamın verdiği sonucu size bildirdi.</p>
      </div>
      {/* the result dialog opens automatically when the page opens. */}
      <VisaOutcomeDialog
        result={result}
        defaultOpen
        triggerClassName="flex h-[46px] flex-none items-center whitespace-nowrap rounded-full bg-white px-[22px] text-sm font-bold text-dash-navy hover:bg-dash-line"
      />
    </section>
  );
}

function CancelledCard({ text }: { text: string }) {
  return (
    <section className={cn(card, "flex flex-wrap items-center gap-4 p-7")}>
      <span aria-hidden className="flex size-12 flex-none items-center justify-center rounded-full bg-dash-line-soft text-dash-ink-2">
        <Ban className="size-[22px]" strokeWidth={2.5} />
      </span>
      <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-1">
        <h2 className="text-lg font-extrabold">{text}</h2>
        {/* The second sentence from the design. */}
        <p className="text-sm text-dash-ink-2">Sorularınız için danışmanınızla iletişime geçebilirsiniz.</p>
      </div>
    </section>
  );
}

// --- Application status timeline -----------------------------------------------

function StepRing({ step, number, refused }: { step: ProgressStep; number: number; refused: boolean }) {
  const base = "flex size-[30px] flex-none items-center justify-center rounded-full text-[13px] font-extrabold";
  if (refused)
    return (
      <span aria-hidden className={cn(base, "bg-dash-red text-white")}>
        <X className="size-3" strokeWidth={3.5} />
      </span>
    );
  if (step.state === "done")
    return (
      <span aria-hidden className={cn(base, "bg-dash-green text-white")}>
        <Check className="size-[13px]" strokeWidth={3.5} />
      </span>
    );
  if (step.state === "attention")
    return (
      <span aria-hidden className={cn(base, "bg-dash-red text-white")}>
        !
      </span>
    );
  if (step.state === "current")
    return (
      <span aria-hidden className={cn(base, "border-[3px] border-dash-red bg-white text-dash-red")}>
        {number}
      </span>
    );
  return (
    <span aria-hidden className={cn(base, "border-2 border-dash-line-strong bg-white text-dash-ink-4")}>
      {number}
    </span>
  );
}

/** For a cancelled application the timeline is faded and has no details (the "cancelled" state in the design). */
const CANCELLED_STEPS = Object.values(PROGRESS_STEP_NAMES);

function StatusTimeline({ progress, hint, refused }: { progress: ApplicationProgress; hint: string | null; refused: boolean }) {
  const cancelled = progress.kind === "cancelled";
  return (
    <section aria-labelledby="status-heading" className={cn(card, "flex flex-col gap-[18px] px-6 pb-2 pt-6", cancelled && "opacity-55")}>
      <div className="flex flex-col gap-1.5">
        <h2 id="status-heading" className={cardTitle}>
          Başvuru durumu
        </h2>
        {hint ? <p className="text-[13px] leading-normal text-dash-ink-2">{hint}</p> : null}
      </div>
      {progress.kind === "active" ? (
        <ol>
          {progress.steps.map((step, index) => {
            const last = index === progress.steps.length - 1;
            const strong = step.state === "current" || step.state === "attention";
            // Visa refusal: the last step with a red cross (the refusal state in the design).
            const stepRefused = refused && step.key === "result";
            return (
              <li key={step.key} className="flex gap-3.5">
                <div className="flex w-[30px] flex-none flex-col items-center">
                  <StepRing step={step} number={index + 1} refused={stepRefused} />
                  {last ? null : <span aria-hidden className={cn("my-1 min-h-3.5 w-0.5 flex-1 rounded-sm", step.state === "done" ? "bg-dash-green" : "bg-dash-field")} />}
                </div>
                <div className="flex min-w-0 flex-col gap-0.5 pb-[18px] pt-[5px]">
                  <p className={cn("text-sm", strong ? "font-extrabold" : "font-semibold", step.state === "pending" ? "text-dash-ink-3" : "text-dash-navy")}>{step.label}</p>
                  <p
                    className={cn(
                      "text-xs font-bold",
                      strong || stepRefused ? "text-dash-red" : step.state === "done" ? "text-dash-green-ink" : "text-dash-ink-4",
                    )}
                  >
                    {step.meta}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <ol>
          {CANCELLED_STEPS.map((label, index) => (
            <li key={label} className="flex gap-3.5">
              <div className="flex w-[30px] flex-none flex-col items-center">
                <span aria-hidden className="flex size-[30px] flex-none items-center justify-center rounded-full border-2 border-dash-line-strong bg-white text-[13px] font-extrabold text-dash-ink-4">
                  {index + 1}
                </span>
                {index === CANCELLED_STEPS.length - 1 ? null : <span aria-hidden className="my-1 min-h-3.5 w-0.5 flex-1 rounded-sm bg-dash-field" />}
              </div>
              <p className="pb-[18px] pt-[5px] text-sm font-semibold text-dash-ink-3">{label}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// --- Appointment -------------------------------------------------------------

const APPOINTMENT_PILLS: Record<AppointmentStatus, { tone: PillTone; icon?: "clock" | "check" }> = {
  not_started: { tone: "neutral" },
  preferences_submitted: { tone: "info", icon: "check" },
  preferences_requested: { tone: "waiting" },
  scheduled: { tone: "done" },
  completed: { tone: "done" },
};

function AppointmentPreferencesCard({ applicationId, status, preferences }: { applicationId: string; status: AppointmentStatus; preferences: StatusViewProps["preferences"] }) {
  const pill = APPOINTMENT_PILLS[status];
  const requested = status === "preferences_requested";
  return (
    <section
      aria-labelledby="appointment-heading"
      className={cn("flex flex-col gap-3.5 rounded-[24px] bg-white p-6", requested ? "border-[1.5px] border-dash-red-border" : "border border-dash-line-soft")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 id="appointment-heading" className={cardTitle}>
          Randevu
        </h2>
        <StatusPill tone={pill.tone} icon={pill.icon} size="sm">
          {APPOINTMENT_STATUS_LABELS[status]}
        </StatusPill>
      </div>
      <p className="text-[13px] leading-[1.6] text-dash-ink-2">
        Kesinleşmiş bir randevunuz henüz yok. Danışmanınız tercihlerinizi dikkate alarak randevu almaya çalışacak ve tarihi size bildirecektir.
      </p>
      {preferences.length > 0 ? (
        <ol>
          {preferences.map((p) => (
            <li key={p.rank} className="flex items-center gap-2.5 border-t border-dash-line-soft py-2.5">
              <span aria-hidden className="flex size-[22px] flex-none items-center justify-center rounded-full bg-dash-navy text-[11px] font-extrabold text-white">
                {p.rank}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[13px] font-bold">
                  <span className="sr-only">{p.rank}. tercih: </span>
                  {p.dateText}
                </span>
                <span className="text-xs text-dash-ink-3">{p.slotText}</span>
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      {requested ? (
        <Link href={customerApplicationPath(applicationId, "appointment")} className={wizButtonClass("primary", "md", "w-full")}>
          Tercih bildir
        </Link>
      ) : null}
    </section>
  );
}

/** Confirmed (or completed) appointment: calendar leaf, date, location and note (the confirmed-appointment state in the design). */
function AppointmentSetCard({ application, letter }: { application: Application; letter: StatusViewProps["appointmentLetter"] }) {
  const at = application.appointmentAt!;
  const leaf = appointmentLeaf(at);
  // Google Maps link the consultant entered for that location in Settings (the button is hidden if none).
  const mapsUrl = appointmentMapsLink(application.appointmentMapsUrl);
  const pill = APPOINTMENT_PILLS[application.appointmentStatus];
  return (
    <section aria-labelledby="appointment-heading" className={cn(card, "flex flex-col gap-4 px-5 py-6 sm:px-7")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="appointment-heading" className={cardTitle}>
          Randevu
        </h2>
        <StatusPill tone={pill.tone} size="sm">
          {APPOINTMENT_STATUS_LABELS[application.appointmentStatus]}
        </StatusPill>
      </div>
      <div className="flex flex-wrap items-center gap-[18px] rounded-[20px] bg-dash-canvas p-5">
        {leaf ? (
          <div aria-hidden className="flex h-[84px] w-[76px] flex-none flex-col items-center justify-center gap-0.5 rounded-[18px] border-[1.5px] border-dash-field bg-white">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-dash-red">{leaf.month}</span>
            <span className="text-[30px] font-extrabold leading-none">{leaf.day}</span>
          </div>
        ) : null}
        <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-1.5">
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-dash-ink-3">Randevu tarihiniz</p>
          <p className="text-lg font-extrabold">{formatDateTimeTr(at)}</p>
          {application.appointmentLocation ? (
            <p className="flex items-center gap-[7px] text-sm text-dash-ink-2">
              <MapPin aria-hidden className="size-[15px] flex-none" strokeWidth={2.5} />
              <span>
                <span className="sr-only">Yer: </span>
                {application.appointmentLocation}
              </span>
            </p>
          ) : null}
          {application.appointmentAddress ? (
            <p className="whitespace-pre-line pl-[22px] text-[13px] leading-[1.5] text-dash-ink-3">
              <span className="sr-only">Adres: </span>
              {application.appointmentAddress}
            </p>
          ) : null}
        </div>
        {mapsUrl ? (
          <a href={mapsUrl} target="_blank" rel="noopener" className={wizButtonClass("secondary", "row", "flex-none")}>
            Haritada aç
            <ExternalLink aria-hidden className="size-3.5" strokeWidth={2.75} />
            <span className="sr-only"> (yeni sekmede açılır)</span>
          </a>
        ) : null}
      </div>
      {application.appointmentNote ? (
        <div className="flex flex-col gap-1 px-1">
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-dash-ink-3">Not</p>
          <p className="whitespace-pre-line text-sm leading-[1.55]">{application.appointmentNote}</p>
        </div>
      ) : null}
      {letter ? (
        <div className="flex flex-wrap items-center gap-3 rounded-[18px] border border-dash-line-soft px-4 py-3.5">
          <FileText aria-hidden className="size-5 flex-none text-dash-ink-2" strokeWidth={2.25} />
          <div className="mr-auto flex min-w-0 flex-[1_1_180px] flex-col gap-0.5">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-dash-ink-3">Randevu belgeniz</p>
            <p className="truncate text-sm font-bold">{letter.originalName}</p>
          </div>
          <div className="flex flex-none gap-2">
            <a href={`/api/files/${letter.id}`} target="_blank" rel="noopener noreferrer" className={wizButtonClass("secondary", "sm")}>
              Görüntüle<span className="sr-only">: randevu belgesi (yeni sekmede açılır)</span>
            </a>
            <a href={`/api/files/${letter.id}?download=1`} className={wizButtonClass("primary", "sm")}>
              <Download aria-hidden className="size-4" strokeWidth={2.5} />
              İndir<span className="sr-only">: randevu belgesi</span>
            </a>
          </div>
        </div>
      ) : null}
    </section>
  );
}

// --- Page ----------------------------------------------------------------------

export function StatusView(props: StatusViewProps) {
  const { application, result, todos } = props;
  const cancelled = application.status === "cancelled";
  const refused = result?.outcome === "refused";
  const appointmentSet = (application.appointmentStatus === "scheduled" || application.appointmentStatus === "completed") && Boolean(application.appointmentAt);

  return (
    <>
      <WizardHeader application={application} current="status" steps={props.steps} statusTone={refused ? "danger" : undefined} />

      {props.justSubmitted && !cancelled ? (
        <div role="status" className="flex items-start gap-3 rounded-[18px] bg-dash-navy-tint px-5 py-4">
          <span aria-hidden className="flex size-[30px] flex-none items-center justify-center rounded-full bg-dash-navy text-white">
            <Check className="size-3.5" strokeWidth={3.5} />
          </span>
          <div className="text-sm leading-[1.55]">
            <p className="font-bold">Başvurunuz bize ulaştı</p>
            <p className="font-medium">
              Bilgileriniz ve belgeleriniz danışmanlarımıza iletildi. Sonraki adım ödemenizi yapıp bildirmenizdir; ayrıntılar aşağıdadır.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid items-start gap-5 min-[900px]:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          {cancelled ? <CancelledCard text={props.statusHint} /> : null}
          {result ? <ResultCard result={result} /> : null}
          {/* The confirmed appointment is at the very top, above the to-dos and messages. */}
          {!cancelled && appointmentSet ? <AppointmentSetCard application={application} letter={props.appointmentLetter} /> : null}
          {/* Once the result is sent, the list only shows if an action is pending; never for a cancelled application. */}
          {!cancelled && (!result || todos.length > 0) ? <TodoCard applicationId={application.id} todos={todos} /> : null}
          <MessagesCard applicationId={application.id} messages={props.messages} />
          {!cancelled && !result ? (
            <PaymentCard application={application} payment={props.payment} receipts={props.receipts} maxUploadBytes={props.maxUploadBytes} />
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <StatusTimeline progress={props.progress} hint={cancelled ? null : props.statusHint} refused={refused} />
          {!cancelled && !appointmentSet ? (
            <AppointmentPreferencesCard applicationId={application.id} status={application.appointmentStatus} preferences={props.preferences} />
          ) : null}
        </div>
      </div>
    </>
  );
}
