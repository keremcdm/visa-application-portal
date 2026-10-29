"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/components/ui/primitives";
import type { NotificationIcon } from "@/features/notifications/display";
import { deleteNotificationsAction, markNotificationReadAction, markNotificationsReadAction } from "@/server/actions/applications";

export type DashboardNotification = {
  id: string;
  icon: NotificationIcon;
  title: string;
  body: string;
  /** Text like "2 saat önce" (2 hours ago) computed on the server. */
  timeText: string;
  read: boolean;
  /** Page to open when the notification is clicked. */
  href: string;
};

type NotificationsState = {
  /** Latest notifications for the bell in the bar and the box on the home page (excluding deleted ones, read state up to date). */
  items: DashboardNotification[];
  unreadCount: number;
  /** Was a notification that came from the server as "unread" marked as read on this screen? */
  isRead: (id: string, serverRead: boolean) => boolean;
  markRead: (id: string) => void;
  markAll: () => void;
  /** Deleted notifications are hidden everywhere until the deletion is final or undone. */
  isHidden: (id: string) => boolean;
  /** Deletes notifications: hidden immediately, final when the "Geri al" period ends or the toast is closed. */
  remove: (ids: readonly string[], text: string) => void;
  error: string | null;
};

const NotificationsContext = createContext<NotificationsState | null>(null);

/** "Geri al" (undo) period. */
const UNDO_MS = 5000;
/** Slide-out duration (same as dash-toast-out in globals.css). */
const LEAVE_MS = 200;

type Toast = { ids: string[]; text: string; key: number; leaving: boolean };

/**
 * Shares notification state between the bell in the bar, the notification box on the home page and the Notifications page.
 * The "read" mark shows on screen immediately; if the server cannot save it, it is rolled back and an error is shown.
 * Deletion works the same everywhere: the notification is hidden and a "Geri al" toast slides in from the bottom; when
 * the time is up the deletion goes to the server, and if the server cannot delete it the notification comes back and an
 * error is shown. If the page is closed within that time no deletion happens (the notification stays).
 */
export function NotificationsProvider({ initial, children }: { initial: DashboardNotification[]; children: ReactNode }) {
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(() => new Set());
  const [allRead, setAllRead] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  // Pending deletion and timers (a ref so the timer and page unload see the latest value).
  const pending = useRef<string[] | null>(null);
  const undoTimer = useRef<number | undefined>(undefined);
  const leaveTimer = useRef<number | undefined>(undefined);
  const toastKey = useRef(0);

  const isRead = (id: string, serverRead: boolean) => serverRead || allRead || readIds.has(id);
  const items = initial.filter((n) => !hiddenIds.has(n.id)).map((n) => (isRead(n.id, n.read) && !n.read ? { ...n, read: true } : n));
  const unreadCount = items.filter((n) => !n.read).length;

  const unhide = (ids: readonly string[]) => setHiddenIds((current) => new Set([...current].filter((id) => !ids.includes(id))));

  const commit = (ids: string[]) => {
    deleteNotificationsAction(ids)
      .then((result) => {
        if (!result.ok) {
          unhide(ids);
          setError(result.message);
        }
      })
      .catch(() => {
        unhide(ids);
        setError("Sunucuya ulaşılamadı. Bildirim silinmedi.");
      });
  };
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });

  /** Closes the toast with a slide. */
  const dismissToast = () => {
    window.clearTimeout(leaveTimer.current);
    setToast((current) => (current ? { ...current, leaving: true } : current));
    leaveTimer.current = window.setTimeout(() => setToast(null), LEAVE_MS);
  };

  /** Time is up or the toast was closed: the deletion becomes final. */
  const finish = () => {
    window.clearTimeout(undoTimer.current);
    if (pending.current) commitRef.current(pending.current);
    pending.current = null;
    dismissToast();
  };
  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  });

  const undo = () => {
    window.clearTimeout(undoTimer.current);
    if (pending.current) unhide(pending.current);
    pending.current = null;
    dismissToast();
  };

  // When leaving the panel (e.g. signing out) a pending deletion becomes final.
  useEffect(
    () => () => {
      window.clearTimeout(undoTimer.current);
      window.clearTimeout(leaveTimer.current);
      if (pending.current) commitRef.current(pending.current);
    },
    [],
  );

  const optimistic = (ids: string[], save: () => Promise<{ ok: boolean; message?: string }>) => {
    if (ids.length === 0) return;
    setError(null);
    setReadIds((current) => new Set([...current, ...ids]));
    const revert = (message: string) => {
      setReadIds((current) => new Set([...current].filter((id) => !ids.includes(id))));
      setError(message);
    };
    save()
      .then((result) => {
        if (!result.ok) revert(result.message ?? "Bildirim okundu olarak işaretlenemedi.");
      })
      .catch(() => revert("Sunucuya ulaşılamadı. Bildirim okundu olarak işaretlenemedi."));
  };

  const value: NotificationsState = {
    items,
    unreadCount,
    error,
    isRead,
    markRead: (id) => {
      if (allRead || readIds.has(id) || initial.find((n) => n.id === id)?.read === true) return;
      optimistic([id], () => markNotificationReadAction(id));
    },
    markAll: () => {
      if (allRead) return;
      setError(null);
      setAllRead(true);
      const revert = (message: string) => {
        setAllRead(false);
        setError(message);
      };
      markNotificationsReadAction()
        .then((result) => {
          if (!result.ok) revert(result.message ?? "Bildirimler okundu olarak işaretlenemedi.");
        })
        .catch(() => revert("Sunucuya ulaşılamadı. Bildirimler okundu olarak işaretlenemedi."));
    },
    isHidden: (id) => hiddenIds.has(id),
    remove: (ids, text) => {
      if (ids.length === 0) return;
      setError(null);
      // If a new deletion happens while the previous one is pending, the previous one becomes final.
      window.clearTimeout(undoTimer.current);
      window.clearTimeout(leaveTimer.current);
      if (pending.current) commit(pending.current);
      setHiddenIds((current) => new Set([...current, ...ids]));
      pending.current = [...ids];
      toastKey.current += 1;
      setToast({ ids: [...ids], text, key: toastKey.current, leaving: false });
      undoTimer.current = window.setTimeout(() => finishRef.current(), UNDO_MS);
    },
  };

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      {toast ? (
        <div
          key={toast.key}
          role="status"
          className={cn(
            "dash-root fixed bottom-7 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3.5 rounded-full bg-dash-navy py-2 pl-5 pr-2 font-dash text-sm text-white shadow-[0_18px_40px_color-mix(in_srgb,var(--color-dash-navy)_28%,transparent)]",
            // Slides in and out from the bottom; no motion when reduced motion is preferred.
            toast.leaving ? "motion-safe:animate-[dash-toast-out_200ms_ease-in_forwards]" : "motion-safe:animate-[dash-toast-in_240ms_ease-out]",
          )}
        >
          <span className="min-w-0 truncate">{toast.text}</span>
          <button type="button" onClick={undo} className="h-9 flex-none rounded-full bg-white px-4 text-sm font-bold text-dash-navy hover:bg-dash-line">
            Geri al
          </button>
          <button
            type="button"
            onClick={() => finishRef.current()}
            aria-label="Kapat"
            className="flex size-9 flex-none items-center justify-center rounded-full text-dash-on-navy hover:bg-white/10"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>
      ) : null}
    </NotificationsContext.Provider>
  );
}

export function useDashboardNotifications(): NotificationsState {
  const value = useContext(NotificationsContext);
  if (!value) throw new Error("useDashboardNotifications, NotificationsProvider içinde kullanılmalıdır.");
  return value;
}
