"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, BadgeCheck, Check, CheckCheck, Clock, FileUp, MessageCircle, Trash2, type LucideIcon } from "lucide-react";
import { useDashboardNotifications } from "@/components/customer/dashboard/notifications-context";
import { cn } from "@/components/ui/primitives";
import {
  filterNotifications,
  groupByDay,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_LABELS,
  type NotificationCategory,
  type NotificationFilter,
  type PendingAction,
} from "@/features/notifications/page";

/*
 * NOTIFICATIONS PAGE VIEW
 * Read state and deletion (including "Geri al") live in NotificationsProvider in the panel frame; the counters in the bar
 * update immediately as well. Instead of per-row deletion and "Okunanları temizle" (clear read ones) there is
 * selection-based deletion: a checkbox on every row, "Tümünü seç" (select all), "Seçilenleri sil" (delete selected) and "Tümünü okundu say" (mark all read).
 */

export type NotificationRow = {
  id: string;
  title: string;
  body: string;
  read: boolean;
  category: NotificationCategory;
  pendingAction: PendingAction | null;
  /** Is the action the notification asks for still pending on the application? */
  requiresAction: boolean;
  /** "01:48" (Istanbul time) */
  time: string;
  dayKey: string;
  dayLabel: string;
  referenceCode: string | null;
  applicationHref: string | null;
  link: { label: string; href: string } | null;
};

const CATEGORY_STYLE: Record<NotificationCategory, { tint: string; dot: string; icon: LucideIcon }> = {
  doc: { tint: "bg-dash-red-tint text-dash-red", dot: "bg-dash-red", icon: FileUp },
  result: { tint: "bg-dash-green-tint text-dash-green-ink", dot: "bg-dash-green", icon: BadgeCheck },
  status: { tint: "bg-dash-navy-tint text-dash-navy", dot: "bg-dash-navy", icon: Clock },
  msg: { tint: "bg-dash-draft-bg text-dash-draft-ink", dot: "bg-dash-yellow", icon: MessageCircle },
};

/** Main button in the action strip: depends on the requested action. */
function bannerPrimary(row: NotificationRow): { label: string; href: string } | null {
  if (!row.link || !row.applicationHref) return null;
  switch (row.pendingAction) {
    case "documents":
      return row.link;
    case "appointment":
      return { label: "Tercihleri bildir", href: row.link.href };
    default:
      return { label: "Başvuruya git", href: row.applicationHref };
  }
}

const pillOutline =
  "flex h-11 flex-none items-center gap-2 whitespace-nowrap rounded-full border-[1.5px] border-dash-line-strong bg-white px-5 text-sm font-bold transition-colors motion-reduce:transition-none";

/** "Tümünü seç": checked if all are selected, indeterminate if some are. */
function SelectAll({ checked, partial, onChange }: { checked: boolean; partial: boolean; onChange: (next: boolean) => void }) {
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (box.current) box.current.indeterminate = partial;
  }, [partial]);
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-sm font-bold text-dash-navy">
      <input ref={box} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-[18px] cursor-pointer accent-dash-navy" />
      Tümünü seç
    </label>
  );
}

export function NotificationsView({ rows }: { rows: NotificationRow[] }) {
  const notifications = useDashboardNotifications();
  const [filter, setFilterState] = useState<NotificationFilter>({ tab: "all", category: "all" });
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  // Selection is cleared when the filter changes, so a notification that is not visible is never deleted by mistake.
  const setFilter = (next: NotificationFilter) => {
    setFilterState(next);
    setSelected(new Set());
  };

  const visible = rows
    .filter((row) => !notifications.isHidden(row.id))
    .map((row) => ({ ...row, read: notifications.isRead(row.id, row.read) }));
  const unreadCount = visible.filter((row) => !row.read).length;
  const { shown, counts } = filterNotifications(visible, filter);
  const groups = groupByDay(shown);
  const selectedShown = shown.filter((row) => selected.has(row.id)).map((row) => row.id);
  const banner = visible.find((row) => row.requiresAction && !row.read) ?? null;
  const bannerAction = banner ? bannerPrimary(banner) : null;
  const BannerIcon = banner ? CATEGORY_STYLE[banner.category].icon : FileUp;

  const openRow = (row: { id: string; read: boolean }) => {
    if (!row.read) notifications.markRead(row.id);
  };
  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const deleteSelected = () => {
    if (selectedShown.length === 0) return;
    notifications.remove(selectedShown, selectedShown.length === 1 ? "Bildirim silindi" : `${selectedShown.length} bildirim silindi`);
    setSelected(new Set());
  };

  return (
    <main id="content" className="mx-auto flex w-full max-w-[1080px] flex-col gap-7 px-4 pb-16 pt-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex max-w-[640px] flex-col gap-2">
          <h1 className="text-[34px] font-extrabold tracking-[-0.02em]">Bildirimler</h1>
          <p className="text-[15px] leading-[1.6] text-dash-ink-2">Başvurunuzla ilgili gelişmeler burada listelenir.</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            disabled={selectedShown.length === 0}
            onClick={deleteSelected}
            className={cn(pillOutline, "text-dash-red enabled:hover:border-dash-red-border enabled:hover:bg-dash-red-tint disabled:opacity-45")}
          >
            <Trash2 aria-hidden className="size-4" strokeWidth={2.5} />
            {selectedShown.length > 0 ? `Seçilenleri sil (${selectedShown.length})` : "Seçilenleri sil"}
          </button>
          <button type="button" onClick={notifications.markAll} className={cn(pillOutline, "text-dash-navy hover:bg-dash-subtle")}>
            <CheckCheck aria-hidden className="size-4" strokeWidth={2.5} />
            Tümünü okundu say
          </button>
        </div>
      </div>

      {notifications.error ? (
        <p role="alert" className="rounded-[22px] border border-dash-red-border bg-dash-red-tint px-5 py-3 text-sm font-semibold text-dash-red">
          {notifications.error}
        </p>
      ) : null}

      {banner && bannerAction ? (
        <section aria-label="İşleminiz bekleniyor" className="flex flex-wrap items-center gap-[22px] rounded-[30px] bg-dash-navy px-[30px] py-[26px] text-white">
          <span className="relative flex size-14 flex-none items-center justify-center rounded-full bg-dash-red">
            <BannerIcon aria-hidden className="size-6" strokeWidth={2.5} />
            <span aria-hidden className="pointer-events-none absolute -inset-[7px] rounded-full border-2 border-dash-red motion-safe:animate-[dash-ring-pulse_1.8s_ease-out_infinite]" />
          </span>
          <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1.5">
            <span className="text-xs font-bold uppercase tracking-[0.08em] text-dash-pink">İşleminiz bekleniyor</span>
            <span className="text-2xl font-extrabold leading-[1.2] tracking-[-0.02em]">{banner.title}</span>
            <span className="text-sm leading-[1.5] text-dash-on-navy">{[banner.referenceCode, banner.body].filter(Boolean).join(" · ")}</span>
          </div>
          <div className="flex flex-none flex-wrap gap-2.5">
            <Link
              href={bannerAction.href}
              onClick={() => openRow(banner)}
              className="flex h-[46px] items-center whitespace-nowrap rounded-full bg-dash-red px-[22px] text-[15px] font-bold text-white hover:bg-dash-red-hover"
            >
              {bannerAction.label}
            </Link>
            {banner.applicationHref && bannerAction.href !== banner.applicationHref ? (
              <Link
                href={banner.applicationHref}
                onClick={() => openRow(banner)}
                className="flex h-[46px] items-center whitespace-nowrap rounded-full border-[1.5px] border-white/30 px-5 text-[15px] font-bold text-white hover:bg-white/10"
              >
                Başvuruya git
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside aria-label="Bildirim süzgeci" className="flex flex-col gap-3 lg:sticky lg:top-6">
          <div className="flex gap-1 rounded-full bg-dash-line-soft p-1">
            {(
              [
                ["all", "Tümü"],
                ["unread", `Okunmamış · ${unreadCount}`],
              ] as const
            ).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                aria-pressed={filter.tab === tab}
                onClick={() => setFilter({ ...filter, tab })}
                className={cn(
                  "h-9 flex-1 rounded-full text-[13px] font-bold",
                  filter.tab === tab ? "bg-white text-dash-navy shadow-[0_1px_2px_color-mix(in_srgb,var(--color-dash-navy)_14%,transparent)]" : "text-dash-ink-2",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-0.5 rounded-[22px] border border-dash-line bg-white p-2">
            <span className="px-3 pb-1.5 pt-2.5 text-xs font-bold uppercase tracking-[0.06em] text-dash-ink-3">Kategori</span>
            {(["all", ...NOTIFICATION_CATEGORIES] as const).map((category) => {
              const active = filter.category === category;
              return (
                <button
                  key={category}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter({ ...filter, category })}
                  className={cn(
                    "flex h-[42px] w-full items-center gap-2.5 rounded-[14px] px-3 text-sm text-dash-navy",
                    active ? "bg-dash-subtle font-bold" : "font-semibold hover:bg-dash-subtle",
                  )}
                >
                  <span aria-hidden className={cn("size-2.5 flex-none rounded-full", category === "all" ? "bg-dash-dot" : CATEGORY_STYLE[category].dot)} />
                  <span className="flex-1 text-left">{category === "all" ? "Tüm kategoriler" : NOTIFICATION_CATEGORY_LABELS[category]}</span>
                  <span
                    className={cn(
                      "flex h-[22px] min-w-6 items-center justify-center rounded-full px-[7px] text-xs font-bold",
                      active ? "bg-dash-navy text-white" : "bg-dash-subtle text-dash-ink-2",
                    )}
                  >
                    {counts[category]}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="flex min-w-0 flex-col gap-[22px]">
          {shown.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-dash-line bg-white px-[18px] py-3">
              <SelectAll
                checked={selectedShown.length === shown.length}
                partial={selectedShown.length > 0 && selectedShown.length < shown.length}
                onChange={(on) => setSelected(on ? new Set(shown.map((row) => row.id)) : new Set())}
              />
              <span className="text-sm text-dash-ink-2" aria-live="polite">
                {selectedShown.length > 0 ? `${selectedShown.length} bildirim seçildi` : "Silmek istediğiniz bildirimleri seçiniz."}
              </span>
            </div>
          ) : null}
          {groups.length === 0 ? (
            <div className="flex flex-col items-center gap-2.5 rounded-[22px] border border-dash-line bg-white px-6 py-12 text-center">
              <span aria-hidden className="flex size-[52px] items-center justify-center rounded-full bg-dash-green-tint text-dash-green-ink">
                <Check className="size-[22px]" strokeWidth={3} />
              </span>
              <span className="text-base font-bold">Her şey güncel</span>
              <span className="text-sm text-dash-ink-2">Bu filtrede gösterilecek bildiriminiz yok.</span>
            </div>
          ) : null}
          {groups.map((group) => (
            <section key={group.key} aria-labelledby={`day-${group.key}`} className="flex flex-col gap-2.5">
              <h2 id={`day-${group.key}`} className="pl-1 text-[13px] font-bold text-dash-ink-3">
                {group.label}
              </h2>
              <ul className="flex flex-col gap-1 rounded-[22px] border border-dash-line bg-white p-2">
                {group.items.map((row) => {
                  const style = CATEGORY_STYLE[row.category];
                  const Icon = style.icon;
                  const unread = !row.read;
                  const isSelected = selected.has(row.id);
                  return (
                    <li
                      key={row.id}
                      // Clicking a row marks the notification as read (design); with the keyboard the same is done through the link.
                      onClick={() => openRow(row)}
                      className={cn(
                        "grid cursor-pointer grid-cols-[auto_44px_minmax(0,1fr)] gap-x-4 gap-y-3 rounded-2xl px-[18px] py-4 transition-colors motion-reduce:transition-none sm:grid-cols-[auto_44px_minmax(0,1fr)_auto]",
                        unread
                          ? row.requiresAction
                            ? "bg-dash-red-tint hover:bg-dash-red-tint-hover"
                            : "bg-dash-unread hover:bg-dash-subtle"
                          : "hover:bg-dash-subtle",
                        isSelected && "ring-[1.5px] ring-inset ring-dash-navy",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => toggle(row.id, event.target.checked)}
                        aria-label={`${row.title} (${row.dayLabel} ${row.time}) bildirimini seç`}
                        className="mt-[13px] size-[18px] cursor-pointer accent-dash-navy"
                      />
                      <span
                        aria-hidden
                        className={cn("relative flex size-11 items-center justify-center rounded-full", row.requiresAction && unread ? "bg-dash-red text-white" : style.tint)}
                      >
                        <Icon className="size-[18px]" strokeWidth={2.5} />
                        {unread ? <span className="absolute -right-px -top-px size-3 rounded-full border-2 border-white bg-dash-red" /> : null}
                      </span>
                      <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className={cn("text-base text-dash-navy", unread ? "font-extrabold" : "font-semibold")}>
                            {row.title}
                            {unread ? <span className="sr-only"> (okunmamış)</span> : null}
                          </h3>
                          {row.requiresAction ? (
                            <span className="rounded-full bg-dash-red px-2.5 py-[3px] text-[11px] font-extrabold tracking-[0.02em] text-white">İşlem gerekiyor</span>
                          ) : null}
                        </div>
                        {row.body ? <p className="whitespace-pre-line text-sm leading-[1.5] text-dash-ink-2 [text-wrap:pretty]">{row.body}</p> : null}
                        <div className="mt-0.5 flex flex-wrap items-center gap-2.5">
                          <span className={cn("text-xs", unread ? "font-bold text-dash-red" : "font-medium text-dash-ink-3")}>{row.time}</span>
                          <span aria-hidden className="size-[3px] rounded-full bg-dash-dot" />
                          {row.referenceCode ? (
                            <span className="rounded-full bg-dash-subtle px-2 py-0.5 text-xs font-bold text-dash-ink-2">{row.referenceCode}</span>
                          ) : null}
                          <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", style.tint)}>{NOTIFICATION_CATEGORY_LABELS[row.category]}</span>
                        </div>
                      </div>
                      {row.link ? (
                        <div className="col-start-3 flex items-center sm:col-start-auto">
                          <Link
                            href={row.link.href}
                            onClick={(event) => {
                              event.stopPropagation();
                              openRow(row);
                            }}
                            className={cn(
                              "flex h-10 flex-none items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-sm font-bold",
                              row.requiresAction
                                ? "bg-dash-red text-white hover:bg-dash-red-hover"
                                : "border-[1.5px] border-dash-line-strong bg-white text-dash-navy hover:bg-dash-subtle",
                            )}
                          >
                            {row.link.label}
                            <ArrowRight aria-hidden className="size-[15px]" strokeWidth={2.75} />
                          </Link>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
