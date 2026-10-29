import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { StatusView } from "@/components/customer/status/status-view";
import { WizardShell } from "@/components/customer/wizard/shell";
import { WizardLoading } from "@/components/customer/wizard/ui";
import { buildCustomerTodos } from "@/features/applications/customer-todos";
import { APPLICATION_STATUS_CUSTOMER_HINTS, APPOINTMENT_SLOT_LABELS } from "@/lib/domain/constants";
import { customerApplicationPath } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";
import { formatDateLongTr, formatDateTimeTr } from "@/lib/validation/formats";
import { completePastAppointments } from "@/server/appointment-completion";
import { requireCustomer } from "@/server/auth";
import { customerProgress, loadApplicationContext, slotState, type WizardStepId } from "@/server/data/customer";
import { fetchAppointmentLetter, fetchMessages, fetchReceipts, fetchStatusHistory, fetchTasks, fetchVisaOutcome } from "@/server/data/queries";
import { maxUploadBytes } from "@/server/limits";

export const metadata: Metadata = { title: "Başvuru durumu" };

const FIRST_STEP_PATH: Record<WizardStepId, string> = {
  type: "type",
  form: "form/personal",
  documents: "documents",
  appointment: "appointment",
  fee: "fee",
  summary: "summary",
};

async function Content({ params, searchParams }: Pick<PageProps<"/panel/applications/[id]">, "params" | "searchParams">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  // Past appointments are marked "Randevu gerçekleşti" (appointment took place) before reading (after authorization).
  await requireCustomer();
  await completePastAppointments();
  const ctx = await loadApplicationContext(id);
  const { application } = ctx;

  // Draft: go to the first incomplete step.
  if (application.status === "draft") {
    const order: WizardStepId[] = ["type", "form", "documents", "appointment", "fee", "summary"];
    const next = order.find((step) => ctx.steps[step] !== "complete") ?? "summary";
    redirect(customerApplicationPath(id, FIRST_STEP_PATH[next]));
  }

  const supabase = await createClient();
  const [messages, tasks, receipts, visaOutcome, history, appointmentLetter] = await Promise.all([
    fetchMessages(supabase, id),
    fetchTasks(supabase, id),
    fetchReceipts(supabase, id),
    fetchVisaOutcome(supabase, id),
    fetchStatusHistory(supabase, id),
    fetchAppointmentLetter(supabase, id),
  ]);
  // The result is only shown while the application is in the "Sonuç müşteriye bildirildi" (result sent to customer) status.
  const result = visaOutcome && application.status === "result_communicated" ? visaOutcome : null;
  // Same rule as the card on the home page (src/app/panel/page.tsx).
  const progress = customerProgress(application, { history, visaOutcomeAt: result?.at ?? null, slots: ctx.slots, tasks });
  const current = progress.kind === "active" && progress.currentIndex !== null ? progress.steps[progress.currentIndex] : null;

  return (
    <StatusView
      application={application}
      steps={ctx.steps}
      justSubmitted={query.submitted === "1"}
      // The description above the timeline comes from the current step (e.g. "Randevunuz danışmanınız tarafından bildirilecek").
      statusHint={current ? `${current.title}. ${current.description}` : APPLICATION_STATUS_CUSTOMER_HINTS[application.status]}
      progress={progress}
      todos={buildCustomerTodos({
        paymentStatus: application.paymentStatus,
        formLocked: application.formLocked,
        appointmentStatus: application.appointmentStatus,
        slots: ctx.slots.map((slot) => ({ id: slot.id, label: slot.label, reviewNote: slot.reviewNote, state: slotState(slot) })),
        tasks,
      })}
      messages={messages.map((m) => ({ id: m.id, body: m.body, dateText: formatDateTimeTr(m.createdAt), unread: m.unread }))}
      payment={ctx.payment}
      receipts={receipts.map((file) => ({ id: file.id, originalName: file.originalName, sizeBytes: file.sizeBytes, createdAtText: formatDateTimeTr(file.createdAt) }))}
      maxUploadBytes={maxUploadBytes()}
      appointmentLetter={appointmentLetter ? { id: appointmentLetter.id, originalName: appointmentLetter.originalName } : null}
      preferences={ctx.preferences.map((p) => ({ rank: p.rank, dateText: formatDateLongTr(p.date), slotText: APPOINTMENT_SLOT_LABELS[p.slot] }))}
      result={
        result
          ? {
              outcome: result.outcome,
              note: result.note,
              atText: formatDateTimeTr(result.at),
              file: result.file ? { id: result.file.id, isImage: result.file.mimeType.startsWith("image/") } : null,
            }
          : null
      }
    />
  );
}

/** Application status page. */
export default function ApplicationOverviewPage({ params, searchParams }: PageProps<"/panel/applications/[id]">) {
  return (
    <WizardShell>
      <Suspense fallback={<WizardLoading lines={6} />}>
        <Content params={params} searchParams={searchParams} />
      </Suspense>
    </WizardShell>
  );
}
