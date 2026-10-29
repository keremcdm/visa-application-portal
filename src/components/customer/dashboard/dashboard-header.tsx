"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Bell, Check, LogOut, Trash2, TriangleAlert, X } from "lucide-react";
import { Logo } from "@/components/layout/site-chrome";
import { cn } from "@/components/ui/primitives";
import { ROUTES } from "@/lib/site";
import { signOutAction } from "@/server/actions/auth";
import { useDashboardNotifications } from "./notifications-context";

/** Risk test summary in the header. `tone`: good (best/good), medium (medium), weak (needs_work/not_advised). */
export type RiskSummary = { label: string; tone: "good" | "medium" | "low" } | null;

function RiskChip({ risk }: { risk: RiskSummary }) {
  const circle = !risk ? "bg-dash-line-strong text-dash-ink-2" : risk.tone === "good" ? "bg-dash-green text-white" : risk.tone === "medium" ? "bg-dash-risk-medium text-white" : "bg-dash-risk-low text-white";
  return (
    <div className="flex flex-none items-center gap-2.5 border-r border-dash-line pr-3.5">
      <span aria-hidden className={cn("flex size-[30px] flex-none items-center justify-center rounded-full", circle)}>
        {risk?.tone === "good" ? <Check className="size-[15px]" strokeWidth={3.5} /> : <TriangleAlert className="size-[15px]" strokeWidth={2.5} />}
      </span>
      {/* Two lines: title and result; words do not wrap to the next line. */}
      <span className="flex flex-col whitespace-nowrap leading-[1.2]">
        <span className="text-[11px] font-semibold text-dash-ink-3">Risk Analiz Testi</span>
        <span className={cn("text-sm font-extrabold", risk?.tone === "good" ? "text-dash-green-ink" : "text-dash-ink")}>{risk ? risk.label : "Henüz yapılmadı"}</span>
      </span>
      <Link href={ROUTES.customerRiskTest} className="ml-1 whitespace-nowrap text-[13px] font-bold text-dash-red hover:text-dash-red-hover">
        {risk ? "Sonuç" : "Teste başla"}
      </Link>
    </div>
  );
}

function BellMenu() {
  const { items, unreadCount, markRead, markAll, remove, error } = useDashboardNotifications();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (root.current && event.target instanceof Node && !root.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={unreadCount > 0 ? `Bildirimler, ${unreadCount} okunmamış` : "Bildirimler"}
        // The bell looks the same on every page.
        className="relative flex size-[42px] items-center justify-center rounded-full border-[1.5px] border-dash-line bg-white text-dash-navy hover:bg-dash-subtle"
      >
        <Bell aria-hidden className="size-[19px]" strokeWidth={2.5} />
        {unreadCount > 0 ? (
          <span aria-hidden className="absolute -right-[3px] -top-[3px] flex h-[19px] min-w-[19px] items-center justify-center rounded-full border-2 border-white bg-dash-red px-[5px] text-[11px] font-extrabold text-white">
            {unreadCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <>
          {/* On phones the dropdown covers the screen and never overflows; the background is dimmed. */}
          <div aria-hidden className="fixed inset-0 z-40 bg-dash-navy/30 sm:hidden" onClick={() => setOpen(false)} />
          <div
            id={panelId}
            className="fixed inset-x-3 top-3 z-50 flex max-h-[calc(100dvh-24px)] flex-col gap-1 rounded-[22px] border border-dash-line bg-white p-3.5 shadow-[0_18px_40px_rgba(25,33,79,0.16)] sm:absolute sm:inset-x-auto sm:right-[-8px] sm:top-[54px] sm:z-20 sm:max-h-none sm:w-[370px]"
          >
            <div className="flex items-center justify-between gap-2 px-2 pb-2.5 pt-1">
              <span className="text-base font-bold">Bildirimler</span>
              <span className="flex items-center gap-3">
                {unreadCount > 0 ? (
                  <button type="button" onClick={markAll} className="text-[13px] font-bold text-dash-red hover:text-dash-red-hover">
                    Tümünü okundu say
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Bildirimleri kapat"
                  className="flex size-9 items-center justify-center rounded-full text-dash-ink-2 hover:bg-dash-subtle hover:text-dash-navy sm:hidden"
                >
                  <X aria-hidden className="size-[18px]" strokeWidth={2.5} />
                </button>
              </span>
            </div>
          {error ? (
            <p role="alert" className="mx-2 mb-1 rounded-xl bg-dash-red-tint px-3 py-2 text-[13px] font-semibold text-dash-red">
              {error}
            </p>
          ) : null}
          {items.length === 0 ? <p className="px-2 py-4 text-center text-sm text-dash-ink-3">Henüz bildiriminiz yok.</p> : null}
          <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto sm:max-h-[60vh] sm:flex-none">
            {items.map((n) => (
              <li
                key={n.id}
                className={cn(
                  "flex items-start gap-1 rounded-2xl pr-1.5 transition-colors motion-reduce:transition-none",
                  n.read ? "bg-transparent hover:bg-dash-subtle" : "bg-dash-red-tint hover:bg-dash-red-tint-hover",
                )}
              >
                {/* Clicking a notification goes to the related page and marks it as read. */}
                <Link
                  href={n.href}
                  onClick={() => {
                    if (!n.read) markRead(n.id);
                    setOpen(false);
                  }}
                  className="flex min-w-0 flex-1 gap-3 rounded-2xl py-3 pl-3.5 text-left text-dash-ink no-underline hover:text-dash-ink"
                >
                  <span aria-hidden className={cn("mt-[5px] size-[9px] flex-none rounded-full", n.read ? "bg-dash-line-strong" : "bg-dash-red")} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm font-bold">
                      {n.title}
                      {n.read ? null : <span className="sr-only"> (okunmamış)</span>}
                    </span>
                    {n.body ? <span className="whitespace-pre-line text-[13px] leading-[1.4] text-dash-ink-2">{n.body}</span> : null}
                    <span className="mt-0.5 text-xs text-dash-ink-4">{n.timeText}</span>
                  </span>
                </Link>
                {/* Notifications in the bell can also be deleted; for a few seconds "Geri al" (undo) restores them. */}
                <button
                  type="button"
                  aria-label={`${n.title}: bildirimi sil`}
                  title="Bildirimi sil"
                  onClick={() => remove([n.id], "Bildirim silindi")}
                  className="mt-2 flex size-8 flex-none items-center justify-center rounded-full text-dash-ink-3 transition-colors hover:bg-white hover:text-dash-red motion-reduce:transition-none"
                >
                  <Trash2 aria-hidden className="size-[15px]" strokeWidth={2.5} />
                </button>
              </li>
            ))}
          </ul>
          <Link
            href={ROUTES.customerNotifications}
            onClick={() => setOpen(false)}
            className="px-2 pb-1 pt-2 text-[13px] font-bold text-dash-red hover:text-dash-red-hover"
          >
            Tüm bildirimler
          </Link>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** The customer panel's top bar; shown on every page of the panel. */
export function DashboardHeader({ userName, risk }: { userName: string; risk: RiskSummary }) {
  const pathname = usePathname();
  const onAccount = pathname.startsWith(ROUTES.customerAccount);
  const onNotifications = pathname.startsWith(ROUTES.customerNotifications);
  // Application pages and the risk test count as "Başvurularım" (my applications). The notifications page is reached through "Tüm bildirimler" in the bell.
  const onApplications = !onNotifications && !onAccount;
  const onRiskTest = pathname.startsWith(ROUTES.customerRiskTest);
  // The same pill links as the admin panel's top bar: the current section has a grey background and bold text, the other
  // gets a grey background on hover.
  const navLinkOf = (active: boolean) =>
    cn(
      "flex items-center whitespace-nowrap rounded-full px-3.5 py-2 text-sm no-underline transition-colors motion-reduce:transition-none",
      active ? "bg-dash-subtle font-bold text-dash-navy hover:text-dash-navy" : "font-semibold text-dash-ink-2 hover:bg-dash-subtle hover:text-dash-navy",
    );
  // The row of three buttons on narrow screens has equal widths.
  const narrowLinkOf = (active: boolean) => cn(navLinkOf(active), "min-w-0 flex-1 justify-center px-2 text-[13px] min-[400px]:text-sm");
  // On wide screens everything is on one line. On narrower screens (including medium widths) the section links move to a
  // second row separated by a thin line.
  return (
    <header className="dash-root no-print relative z-10 border-b border-dash-line bg-white font-dash text-dash-ink">
      <div className="mx-auto flex min-h-[68px] max-w-[1080px] items-center gap-x-[18px] px-6 py-3 lg:py-0">
        <Logo href={ROUTES.customer} height={34} />
        <span aria-hidden className="hidden h-6 w-px bg-dash-line-strong sm:block" />
        <span className="hidden whitespace-nowrap text-sm text-dash-ink-2 sm:inline">Müşteri paneli</span>
        {/* The "Bildirimler" (notifications) link was removed; the counter in the bell and "Tüm bildirimler" are enough. */}
        <nav aria-label="Müşteri paneli" className="ml-2.5 hidden gap-1 lg:flex">
          <Link href={ROUTES.customer} aria-current={onApplications ? "page" : undefined} className={navLinkOf(onApplications)}>
            Başvurularım
          </Link>
          <Link href={ROUTES.customerAccount} aria-current={onAccount ? "page" : undefined} className={navLinkOf(onAccount)}>
            Hesabım
          </Link>
        </nav>
        <div className="flex-1" />
        <div className="hidden lg:flex">
          <RiskChip risk={risk} />
        </div>
        <BellMenu />
        <span className="hidden min-w-0 truncate text-sm text-dash-ink-2 sm:inline lg:hidden xl:inline">{userName}</span>
        <form action={signOutAction}>
          <button
            type="submit"
            className="flex h-10 items-center gap-2 whitespace-nowrap rounded-full border-[1.5px] border-dash-line bg-white px-4 text-sm font-bold text-dash-navy hover:bg-dash-subtle"
          >
            <LogOut aria-hidden className="size-4" strokeWidth={2.5} />
            Çıkış
          </button>
        </form>
      </div>
      {/* On narrow screens the second row is three equal buttons; the risk test result is shown on the test page (the result
          summary was cramped in this row). */}
      <div className="border-t border-dash-line lg:hidden">
        <nav aria-label="Müşteri paneli" className="mx-auto flex max-w-[1080px] gap-1 px-4 py-2.5 sm:px-6">
          <Link href={ROUTES.customer} aria-current={onApplications && !onRiskTest ? "page" : undefined} className={narrowLinkOf(onApplications && !onRiskTest)}>
            Başvurularım
          </Link>
          <Link href={ROUTES.customerAccount} aria-current={onAccount ? "page" : undefined} className={narrowLinkOf(onAccount)}>
            Hesabım
          </Link>
          <Link href={ROUTES.customerRiskTest} aria-current={onRiskTest ? "page" : undefined} className={narrowLinkOf(onRiskTest)}>
            Risk testi
          </Link>
        </nav>
      </div>
    </header>
  );
}
