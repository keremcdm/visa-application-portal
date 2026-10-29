/**
 * Display of notifications on the customer panel home page.
 */

export type NotificationIcon = "appointment" | "payment" | "document" | "general";

/** Icon by notification type: appointment, payment, document; the others (message, status, task, result) generic. */
export function notificationIcon(kind: string): NotificationIcon {
  if (kind.startsWith("appointment.")) return "appointment";
  if (kind.startsWith("payment.")) return "payment";
  if (kind.startsWith("document.")) return "document";
  return "general";
}

const ISTANBUL_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Istanbul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function istanbul(date: Date): { day: string; time: string; dmy: string } {
  const parts = Object.fromEntries(ISTANBUL_PARTS.formatToParts(date).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, dmy: `${parts.day}.${parts.month}.${parts.year}` };
}

/**
 * Time of the notification: "Az önce", "12 dakika önce", "2 saat önce", "Bugün 09:40", "Dün 18:05", "14.10.2026".
 * Computed once on the server and sent as text (not recomputed in the browser).
 */
export function formatNotificationTime(iso: string, now: Date): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (minutes < 1) return "Az önce";
  if (minutes < 60) return `${minutes} dakika önce`;
  const then = istanbul(date);
  const today = istanbul(now);
  if (then.day === today.day) return minutes < 6 * 60 ? `${Math.floor(minutes / 60)} saat önce` : `Bugün ${then.time}`;
  const yesterday = istanbul(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  if (then.day === yesterday.day) return `Dün ${then.time}`;
  return then.dmy;
}
