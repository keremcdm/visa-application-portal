import type { Metadata } from "next";
import { Suspense } from "react";
import { NotificationsView, type NotificationRow } from "@/components/customer/notifications/notifications-view";
import { LoadingBlock } from "@/components/ui/primitives";
import { needsCustomerAction } from "@/features/documents/rules";
import {
  notificationCategory,
  notificationClock,
  notificationDay,
  notificationLink,
  notificationPendingAction,
  notificationRequiresAction,
  type OutstandingActions,
} from "@/features/notifications/page";
import { createClient } from "@/lib/supabase/server";
import { requireCustomer } from "@/server/auth";
import { slotState } from "@/server/data/customer";
import { fetchApplicationsOfCustomer, fetchDocumentSlots, fetchNotifications, fetchTasks } from "@/server/data/queries";

/*
 * NOTIFICATIONS PAGE
 * Taken from the design. The top bar and notification
 * state (read, deleted) live in the panel frame (src/app/panel/layout.tsx); colors are the `dash-*` tokens.
 */

export const metadata: Metadata = { title: "Bildirimler" };

const NOTIFICATION_LIMIT = 100;

async function Notifications() {
  const user = await requireCustomer();
  const supabase = await createClient();
  // RLS: only the user's own notifications and applications are returned.
  const [notifications, applications] = await Promise.all([
    fetchNotifications(supabase, NOTIFICATION_LIMIT),
    fetchApplicationsOfCustomer(supabase, user.id),
  ]);
  const applicationById = new Map(applications.map((a) => [a.id, a]));

  // "Action required" is computed from the application's current status: only for applications with a notification that asks for action.
  const needsCheck = new Set(notifications.filter((n) => n.applicationId && notificationPendingAction(n.kind)).map((n) => n.applicationId!));
  const outstanding = new Map<string, OutstandingActions>();
  await Promise.all(
    [...needsCheck].map(async (id) => {
      const application = applicationById.get(id);
      if (!application) return;
      const [slots, tasks] = await Promise.all([fetchDocumentSlots(supabase, id), fetchTasks(supabase, id)]);
      const open = application.status !== "cancelled";
      outstanding.set(id, {
        documents: open && slots.some((slot) => needsCustomerAction(slotState(slot))),
        form: open && application.status !== "draft" && !application.formLocked,
        task: open && tasks.some((task) => task.status === "open"),
        appointment: open && application.appointmentStatus === "preferences_requested",
      });
    }),
  );

  const now = new Date();
  const rows: NotificationRow[] = notifications.map((n) => {
    const application = n.applicationId ? applicationById.get(n.applicationId) : undefined;
    const day = notificationDay(n.createdAt, now);
    return {
      id: n.id,
      title: n.title,
      body: n.body,
      read: n.read,
      category: notificationCategory(n.kind),
      pendingAction: notificationPendingAction(n.kind),
      requiresAction: application ? notificationRequiresAction(n.kind, outstanding.get(application.id)) : false,
      time: notificationClock(n.createdAt),
      dayKey: day.key,
      dayLabel: day.label,
      referenceCode: application?.referenceCode ?? null,
      applicationHref: application ? notificationLink("application.status", application.id).href : null,
      link: application ? notificationLink(n.kind, application.id) : null,
    };
  });

  return <NotificationsView rows={rows} />;
}

function NotificationsLoading() {
  return (
    <main id="content" className="mx-auto w-full max-w-[1080px] px-4 pb-16 pt-10 sm:px-6">
      <LoadingBlock label="Bildirimleriniz yükleniyor…" />
    </main>
  );
}

export default function NotificationsPage() {
  return (
    <div className="dash-root flex flex-1 flex-col bg-dash-canvas font-dash text-dash-ink">
      <Suspense fallback={<NotificationsLoading />}>
        <Notifications />
      </Suspense>
    </div>
  );
}
