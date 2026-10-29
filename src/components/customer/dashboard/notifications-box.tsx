"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/components/ui/primitives";
import { ROUTES } from "@/lib/site";
import { NotificationTypeIcon } from "./notification-icon";
import { useDashboardNotifications } from "./notifications-context";

/** Maximum number of notifications shown on the home page; the rest are on the "Tüm bildirimler" page. */
const VISIBLE = 6;

/** Notification box in the right column: "Tümü" (all) and "Okunmamış" (unread) tabs. */
export function NotificationsBox() {
  const { items, unreadCount, markRead, error } = useDashboardNotifications();
  const [tab, setTab] = useState<"all" | "unread">("all");
  const list = tab === "unread" ? items.filter((n) => !n.read) : items;
  const shown = list.slice(0, VISIBLE);

  const tabClass = (active: boolean) =>
    cn(
      "h-[34px] flex-1 rounded-full text-[13px] font-bold",
      active ? "bg-white text-dash-navy shadow-[0_1px_2px_rgba(25,33,79,0.14)]" : "bg-transparent text-dash-ink-2",
    );

  return (
    <section aria-labelledby="notifications-heading" className="flex flex-col gap-3">
      <h2 id="notifications-heading" className="font-dash text-[22px] font-extrabold tracking-[-0.02em]">
        Bildirimler
      </h2>
      <div className="flex flex-col gap-1.5 rounded-[22px] border border-dash-line bg-white p-3">
        <div className="mb-1.5 flex gap-1 rounded-full bg-dash-subtle p-1">
          <button type="button" aria-pressed={tab === "all"} onClick={() => setTab("all")} className={tabClass(tab === "all")}>
            Tümü
          </button>
          <button type="button" aria-pressed={tab === "unread"} onClick={() => setTab("unread")} className={tabClass(tab === "unread")}>
            Okunmamış · {unreadCount}
          </button>
        </div>
        {error ? (
          <p role="alert" className="px-2 text-[13px] font-medium text-dash-red">
            {error}
          </p>
        ) : null}
        {shown.length === 0 ? (
          <p className="px-2.5 py-[22px] text-center text-sm text-dash-ink-3">{tab === "unread" ? "Okunmamış bildiriminiz yok." : "Henüz bildiriminiz yok."}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {shown.map((n) => (
              <li key={n.id}>
                {/* Clicking a notification goes to the related page and marks the notification as read. */}
                <Link
                  href={n.href}
                  onClick={() => {
                    if (!n.read) markRead(n.id);
                  }}
                  className={cn(
                    "flex w-full gap-3 rounded-2xl px-3.5 py-3 text-left text-dash-ink no-underline hover:text-dash-ink",
                    n.read ? "bg-transparent hover:bg-dash-subtle" : "bg-dash-red-tint hover:bg-dash-red-tint-hover",
                  )}
                >
                  <NotificationTypeIcon icon={n.icon} unread={!n.read} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm font-bold">
                      {n.title}
                      {n.read ? null : <span className="sr-only"> (okunmamış)</span>}
                    </span>
                    {n.body ? <span className="whitespace-pre-line text-[13px] leading-[1.4] text-dash-ink-2">{n.body}</span> : null}
                    <span className={cn("mt-0.5 text-xs", n.read ? "font-normal text-dash-ink-4" : "font-bold text-dash-red")}>{n.timeText}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {list.length > VISIBLE ? (
          <Link href={ROUTES.customerNotifications} className="px-3.5 pb-1.5 pt-2 text-[13px] font-bold text-dash-red hover:text-dash-red-hover">
            Tüm bildirimler
          </Link>
        ) : null}
      </div>
    </section>
  );
}
