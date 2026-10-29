import { customerApplicationPath } from "@/lib/site";

/**
 * NOTIFICATIONS PAGE RULES
 * Category, "action required" state, the row's button and day groups. Pure functions; used by the page and components.
 */

/** The four categories from the design, in the design's order. */
export const NOTIFICATION_CATEGORIES = ["doc", "result", "status", "msg"] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  doc: "Evrak talepleri",
  result: "Sonuçlar",
  status: "Durum güncellemeleri",
  msg: "Mesajlar",
};

/**
 * Category from the notification type. The design has four categories; appointment, payment, form and task notifications
 * are shown under "Durum güncellemeleri" (status updates).
 */
export function notificationCategory(kind: string): NotificationCategory {
  if (kind.startsWith("document.")) return "doc";
  if (kind === "application.visa_outcome") return "result";
  if (kind.startsWith("message.")) return "msg";
  return "status";
}

/** Kind of action a notification asks of the customer. */
export type PendingAction = "documents" | "form" | "task" | "appointment";

export function notificationPendingAction(kind: string): PendingAction | null {
  switch (kind) {
    case "document.requested":
    case "document.sent":
    case "document.action_required":
      return "documents";
    case "form.unlocked":
      return "form";
    case "task.new":
      return "task";
    case "appointment.preferences_requested":
      return "appointment";
    default:
      return null;
  }
}

/** Actions still expected from the customer on the application (computed from the application's current status). */
export type OutstandingActions = Readonly<Record<PendingAction, boolean>>;

/**
 * "Action required": if the notification asks for an action AND that action is still pending on the application. If the
 * customer uploaded the requested document the old notification no longer requires action (even if unread).
 */
export function notificationRequiresAction(kind: string, outstanding: OutstandingActions | undefined): boolean {
  const action = notificationPendingAction(kind);
  return action !== null && outstanding?.[action] === true;
}

/** The row's button (labels from the design, by type) and the page it goes to. */
/** Id of the "Danışmanınızın istediği belgeler" (documents your consultant requested) section on the Documents page (notification and e-mail links). */
export const REQUESTED_DOCUMENTS_ANCHOR = "requested-documents";

export function notificationLink(kind: string, applicationId: string): { label: string; href: string } {
  const base = customerApplicationPath(applicationId);
  switch (notificationCategory(kind)) {
    case "doc":
      // Goes to the section with the documents the consultant requested on the Documents page.
      return { label: "Belgeyi yükle", href: `${customerApplicationPath(applicationId, "documents")}#${REQUESTED_DOCUMENTS_ANCHOR}` };
    case "result":
      return { label: "Sonucu gör", href: base };
    case "msg":
      return { label: "Mesajı aç", href: `${base}#messages` };
    default:
      if (kind === "appointment.preferences_requested") return { label: "Başvuruya git", href: customerApplicationPath(applicationId, "appointment") };
      return { label: "Başvuruya git", href: base };
  }
}

const ISTANBUL = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Istanbul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function parts(date: Date): { day: string; dmy: string; time: string } {
  const p = Object.fromEntries(ISTANBUL.formatToParts(date).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, dmy: `${p.day}.${p.month}.${p.year}`, time: `${p.hour}:${p.minute}` };
}

/** Day group (Istanbul time): "Bugün", "Dün · 14.10.2026", "13.10.2026". `key` is for sorting and grouping. */
export function notificationDay(iso: string, now: Date): { key: string; label: string } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { key: "", label: "" };
  const then = parts(date);
  if (then.day === parts(now).day) return { key: then.day, label: "Bugün" };
  if (then.day === parts(new Date(now.getTime() - 24 * 60 * 60 * 1000)).day) return { key: then.day, label: `Dün · ${then.dmy}` };
  return { key: then.day, label: then.dmy };
}

/** Time ("01:48", Istanbul time). */
export function notificationClock(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : parts(date).time;
}

/** Splits consecutive notifications (sorted newest first) into day groups. */
export function groupByDay<T extends { dayKey: string; dayLabel: string }>(items: readonly T[]): { key: string; label: string; items: T[] }[] {
  const groups: { key: string; label: string; items: T[] }[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last.key === item.dayKey) last.items.push(item);
    else groups.push({ key: item.dayKey, label: item.dayLabel, items: [item] });
  }
  return groups;
}

export type NotificationFilter = { tab: "all" | "unread"; category: NotificationCategory | "all" };

/** The tab and category filters are applied together; category counts depend on the selected tab (the rule from the design). */
export function filterNotifications<T extends { category: NotificationCategory; read: boolean }>(
  items: readonly T[],
  filter: NotificationFilter,
): { shown: T[]; counts: Record<NotificationCategory | "all", number> } {
  const byTab = items.filter((n) => filter.tab === "all" || !n.read);
  const counts = { all: byTab.length } as Record<NotificationCategory | "all", number>;
  for (const category of NOTIFICATION_CATEGORIES) counts[category] = byTab.filter((n) => n.category === category).length;
  const shown = byTab.filter((n) => filter.category === "all" || n.category === filter.category);
  return { shown, counts };
}
