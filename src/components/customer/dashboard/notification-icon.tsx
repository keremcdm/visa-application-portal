import { Bell, Calendar, CreditCard, FileCheck } from "lucide-react";
import { cn } from "@/components/ui/primitives";
import type { NotificationIcon } from "@/features/notifications/display";

const ICONS = { appointment: Calendar, payment: CreditCard, document: FileCheck, general: Bell } as const;

/** Notification type icon (38px circle); a red dot at the top right if unread. */
export function NotificationTypeIcon({ icon, unread }: { icon: NotificationIcon; unread: boolean }) {
  const Icon = ICONS[icon];
  const green = icon === "payment" || icon === "document";
  return (
    <span
      aria-hidden
      className={cn(
        "relative flex size-[38px] flex-none items-center justify-center rounded-full",
        green ? "bg-dash-green-tint text-dash-green-ink" : "bg-dash-navy-tint text-dash-navy",
      )}
    >
      <Icon className="size-[17px]" strokeWidth={2.5} />
      {unread ? <span className="absolute -right-px -top-px size-[11px] rounded-full border-2 border-white bg-dash-red" /> : null}
    </span>
  );
}
