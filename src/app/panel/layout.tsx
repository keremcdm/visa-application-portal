import { Suspense } from "react";
import { DashboardHeader, type RiskSummary } from "@/components/customer/dashboard/dashboard-header";
import { NotificationsProvider } from "@/components/customer/dashboard/notifications-context";
import { SiteFooter } from "@/components/layout/site-chrome";
import { cn, LoadingBlock } from "@/components/ui/primitives";
import { formatNotificationTime, notificationIcon } from "@/features/notifications/display";
import { notificationLink } from "@/features/notifications/page";
import { evaluateRiskTest } from "@/features/risk-test/scoring";
import { figtree } from "@/lib/fonts/figtree";
import { ROUTES } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";
import { requireCustomer } from "@/server/auth";
import { companyContactFrom, fetchNotifications, fetchRiskAssessment, fetchSettings } from "@/server/data/queries";

/*
 * CUSTOMER PANEL FRAME
 * The top bar uses the design language and appears on every
 * page of the panel. Page content keeps its own layout:
 * the Figtree font and `dash-*` colors are used in this bar, on the home page (src/app/panel/page.tsx), on the
 * notifications page and in the application steps (src/components/customer/wizard/); they share the same design language.
 * Notifications are shared between the bell in the bar and the notification box on the home page (NotificationsProvider).
 */


const NOTIFICATION_LIMIT = 30;

function riskSummary(answers: number[] | null): RiskSummary {
  if (!answers) return null;
  const band = evaluateRiskTest(answers).band;
  const tone = band.key === "best" || band.key === "good" ? "good" : band.key === "medium" ? "medium" : "low";
  return { label: band.badge, tone };
}

async function PanelChrome({ children }: { children: React.ReactNode }) {
  const user = await requireCustomer();
  const supabase = await createClient();
  const [riskAssessment, notifications] = await Promise.all([fetchRiskAssessment(supabase, user.id), fetchNotifications(supabase, NOTIFICATION_LIMIT)]);
  const now = new Date();
  return (
    <NotificationsProvider
      initial={notifications.map((n) => ({
        id: n.id,
        icon: notificationIcon(n.kind),
        title: n.title,
        body: n.body,
        timeText: formatNotificationTime(n.createdAt, now),
        read: n.read,
        href: n.applicationId ? notificationLink(n.kind, n.applicationId).href : ROUTES.customerNotifications,
      }))}
    >
      <DashboardHeader userName={`${user.firstName} ${user.lastName}`.trim() || user.email} risk={riskSummary(riskAssessment?.answers ?? null)} />
      {children}
    </NotificationsProvider>
  );
}

/** Panel footer: with the company contact details from Settings. */
async function PanelFooter() {
  await requireCustomer();
  const settings = await fetchSettings(await createClient());
  return <SiteFooter contact={companyContactFrom(settings)} />;
}

function ChromeLoading() {
  return (
    <>
      <div className="h-[68px] border-b border-dash-line bg-white" aria-hidden />
      <main id="content" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
        <LoadingBlock label="Yükleniyor…" />
      </main>
    </>
  );
}

export default function CustomerPanelLayout({ children }: LayoutProps<"/panel">) {
  return (
    <div className={cn(figtree.variable, "flex min-h-full flex-1 flex-col")}>
      <Suspense fallback={<ChromeLoading />}>
        <PanelChrome>{children}</PanelChrome>
      </Suspense>
      <Suspense fallback={<SiteFooter />}>
        <PanelFooter />
      </Suspense>
    </div>
  );
}
