import type { Metadata } from "next";
import { Suspense } from "react";
import { DashboardView } from "@/components/customer/dashboard/dashboard-view";
import { LoadingBlock } from "@/components/ui/primitives";
import { finishedAt, isArchived } from "@/features/applications/archive";
import { istanbulDate } from "@/features/applications/progress";
import { appointmentMapsLink, appointmentParts, showUpcomingAppointment } from "@/features/appointments/calendar";
import { APPLICATION_STATUS_CUSTOMER_HINTS, APPLICATION_TYPE_LABELS, type ApplicationType } from "@/lib/domain/constants";
import { customerApplicationPath } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";
import { formatDateTimeTr } from "@/lib/validation/formats";
import { completePastAppointments } from "@/server/appointment-completion";
import { requireCustomer } from "@/server/auth";
import { customerProgress } from "@/server/data/customer";
import type { Application } from "@/server/data/types";
import {
  companyContactFrom,
  fetchApplicantNames,
  fetchApplicationsOfCustomer,
  fetchDocumentSlots,
  fetchRiskAssessment,
  fetchSettings,
  fetchStatusHistory,
  fetchTasks,
  fetchVisaOutcome,
} from "@/server/data/queries";

/*
 * CUSTOMER PANEL HOME PAGE
 * Taken one-to-one from the design. Colors are the `dash-*` tokens in globals.css; the Figtree font is loaded in the panel
 * frame (src/app/panel/layout.tsx). Pill-shaped buttons, large corner radii and the pulse on the current step are
 * specific to this screen. The top bar is shared by every page of the panel; the content of other pages
 * (src/app/panel/(pages)) keeps its own layout.
 */

export const metadata: Metadata = { title: "Başvurularım" };

function typeText(types: readonly ApplicationType[]): string {
  return types.map((t) => APPLICATION_TYPE_LABELS[t]).join(", ");
}

/**
 * A confirmed appointment whose day has not passed yet: shown on the home page as a calendar leaf. Hidden once the day has passed or the application is concluded/cancelled.
 */
function scheduledAppointment(application: Application, now: Date) {
  if (!showUpcomingAppointment(application, now) || !application.appointmentAt) return null;
  const parts = appointmentParts(application.appointmentAt);
  if (!parts) return null;
  return {
    month: parts.month,
    day: parts.day,
    year: parts.year,
    longDate: parts.longDate,
    time: parts.time,
    atText: formatDateTimeTr(application.appointmentAt),
    location: application.appointmentLocation,
    address: application.appointmentAddress,
    mapsUrl: appointmentMapsLink(application.appointmentMapsUrl),
  };
}

async function Dashboard() {
  const user = await requireCustomer();
  // Past appointments are marked "Randevu gerçekleşti" before reading (so the card shows the current stage).
  await completePastAppointments();
  const supabase = await createClient();
  const [applications, riskAssessment, settings] = await Promise.all([
    fetchApplicationsOfCustomer(supabase, user.id),
    fetchRiskAssessment(supabase, user.id),
    fetchSettings(supabase),
  ]);
  const drafts = applications.filter((a) => a.status === "draft");
  // All submitted applications are shown on one navy card; ongoing ones first, cancelled ones last.
  const submitted = applications
    .filter((a) => a.status !== "draft")
    .sort((a, b) => Number(a.status === "cancelled") - Number(b.status === "cancelled") || Number(a.status === "result_communicated") - Number(b.status === "result_communicated"));
  const [names, details] = await Promise.all([
    fetchApplicantNames(supabase, submitted.map((a) => a.id)),
    Promise.all(
      submitted.map(async (application) => {
        const [history, visaOutcome, slots, tasks] = await Promise.all([
          fetchStatusHistory(supabase, application.id),
          fetchVisaOutcome(supabase, application.id),
          fetchDocumentSlots(supabase, application.id),
          fetchTasks(supabase, application.id),
        ]);
        return { application, history, visaOutcome, slots, tasks };
      }),
    ),
  ]);
  // Applications concluded or cancelled about two weeks ago move to the "Eski başvurular" (past applications) section.
  const now = new Date();
  const withFinish = details.map((detail) => ({
    ...detail,
    finished: finishedAt(detail.application.status, detail.history, detail.visaOutcome?.at ?? detail.application.updatedAt),
  }));
  const active = withFinish.filter((d) => !isArchived(d.application.status, d.finished, now));
  const old = withFinish.filter((d) => isArchived(d.application.status, d.finished, now));

  return (
    <DashboardView
      firstName={user.firstName}
      riskTestDone={riskAssessment !== null}
      hasApplications={applications.length > 0}
      contact={companyContactFrom(settings)}
      drafts={drafts.map((draft) => ({
        id: draft.id,
        referenceCode: draft.referenceCode,
        typeText: draft.applicationTypes.length > 0 ? typeText(draft.applicationTypes) : "Başvuru tipi henüz seçilmedi",
        updatedText: formatDateTimeTr(draft.updatedAt),
        href: customerApplicationPath(draft.id),
      }))}
      archived={old.map(({ application, visaOutcome, finished }) => ({
        id: application.id,
        href: customerApplicationPath(application.id),
        referenceCode: application.referenceCode,
        applicantName: names.get(application.id) ?? null,
        typeText: typeText(application.applicationTypes),
        outcome: application.status === "cancelled" ? "cancelled" : (visaOutcome?.outcome ?? "finished"),
        finishedText: finished ? istanbulDate(finished) : "",
      }))}
      submitted={active.map(({ application, history, visaOutcome, slots, tasks }) => {
        // The result is only shown while the application is in the "Sonuç müşteriye bildirildi" status.
        const result = visaOutcome && application.status === "result_communicated" ? visaOutcome : null;
        return {
          id: application.id,
          href: customerApplicationPath(application.id),
          referenceCode: application.referenceCode,
          applicantName: names.get(application.id) ?? null,
          typeText: typeText(application.applicationTypes),
          submittedText: application.submittedAt ? formatDateTimeTr(application.submittedAt) : null,
          progress: customerProgress(application, { history, visaOutcomeAt: result?.at ?? null, slots, tasks }),
          cancelledText: APPLICATION_STATUS_CUSTOMER_HINTS.cancelled,
          appointment: scheduledAppointment(application, now),
          result: result
            ? {
                outcome: result.outcome,
                note: result.note,
                atText: formatDateTimeTr(result.at),
                file: result.file ? { id: result.file.id, isImage: result.file.mimeType.startsWith("image/") } : null,
              }
            : null,
        };
      })}
    />
  );
}

function DashboardLoading() {
  return (
    <main id="content" className="mx-auto w-full max-w-[1080px] px-4 pb-16 pt-10 sm:px-6">
      <LoadingBlock label="Başvurularınız yükleniyor…" />
    </main>
  );
}

export default function CustomerDashboardPage() {
  return (
    <div className="dash-root flex flex-1 flex-col bg-dash-canvas font-dash text-dash-ink">
      <Suspense fallback={<DashboardLoading />}>
        <Dashboard />
      </Suspense>
    </div>
  );
}
