"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { CircleAlert } from "lucide-react";
import {
  changedKeys,
  isNewRowKey,
  newRowKey,
  pruneDrafts,
  sameValues,
  savedDespiteFailure,
  withoutRowErrors,
  type DraftRow,
  type Drafts,
} from "@/features/unsaved-changes/drafts";
import { guardedDestination } from "@/features/unsaved-changes/navigation";
import type { ActionResult } from "@/server/result";
import { ActionFeedback } from "./action-button";
import { Dialog, DIALOG_BUTTON, DialogClose } from "./dialog";
import { Button } from "./primitives";

type Feedback = { tone: "success" | "error"; text: string } | null;

/** How long the result stays visible in the bar after a successful save. */
const SAVED_NOTICE_MS = 5000;

/**
 * Keeps the user-modified versions of the rows in a tab (drafts) and the new, not yet saved rows opened with the
 * "Ekle" (add) button.
 *
 * `rows` are the values from the server and must stay the same object between renders (produced with useMemo).
 * When new data arrives from the server (refresh after saving or deleting) drafts without changes are dropped;
 * unsaved drafts are kept.
 */
export function useDraftRows<T extends DraftRow>(rows: Readonly<Record<string, T>>) {
  const [drafts, setDrafts] = useState<Drafts<T>>({});
  // Saved values are shown until refreshed data arrives from the server (so the old value never flashes).
  const [committed, setCommitted] = useState<Drafts<T>>({});
  const [added, setAdded] = useState<{ key: string; value: T }[]>([]);
  const [errors, setErrors] = useState<Record<string, string> | undefined>(undefined);
  const [source, setSource] = useState(rows);
  const addedCount = useRef(0);

  let currentDrafts = drafts;
  let currentCommitted = committed;
  if (source !== rows) {
    setSource(rows);
    currentCommitted = {};
    setCommitted(currentCommitted);
    currentDrafts = pruneDrafts(drafts, (key) => rows[key]);
    if (currentDrafts !== drafts) setDrafts(currentDrafts);
  }

  const base = (key: string): T | undefined => currentCommitted[key] ?? rows[key];
  const changed = changedKeys(currentDrafts, base);
  const value = (key: string): T => (isNewRowKey(key) ? added.find((row) => row.key === key)!.value : (currentDrafts[key] ?? base(key)!));
  const clearRowErrors = (key: string) => setErrors((current) => (current ? withoutRowErrors(current, key) : current));

  return {
    /** Ids of changed (existing) rows. */
    changed,
    /** New, unsaved rows opened with "Ekle". */
    added,
    /** Number of unsaved changes: changed rows + new rows. */
    count: changed.length + added.length,
    /** Row errors from the last save attempt (format: drafts.ts). */
    errors,
    base,
    value,
    isChanged: (key: string) => changed.includes(key),
    update: (key: string, next: T) => {
      if (isNewRowKey(key)) setAdded((current) => current.map((row) => (row.key === key ? { key, value: next } : row)));
      else setDrafts((current) => ({ ...current, [key]: next }));
      // When the user starts fixing a row, that row's old error mark disappears.
      clearRowErrors(key);
    },
    /** Opens an empty new row; returns its id. */
    addRow: (template: T): string => {
      addedCount.current += 1;
      const key = newRowKey(addedCount.current);
      setAdded((current) => [...current, { key, value: template }]);
      return key;
    },
    /** Removes a new row that has not been saved yet. */
    removeRow: (key: string) => {
      setAdded((current) => current.filter((row) => row.key !== key));
      clearRowErrors(key);
    },
    discard: () => {
      setDrafts({});
      setAdded([]);
      setErrors(undefined);
    },
    /** Everything to save: changed rows (updates), new rows (creates) and the values sent (sent). */
    collect: () => {
      const sent: Record<string, T> = {};
      const updates = changed.map((id) => {
        sent[id] = value(id);
        return { id, values: sent[id] };
      });
      const creates = added.map((row) => {
        sent[row.key] = row.value;
        return { key: row.key, values: row.value };
      });
      return { sent, updates, creates };
    },
    /**
     * Handles the save result. `sent` holds the values of the rows at the moment they were sent; a saved row's draft is
     * dropped unless the user changed it again in the meantime. A saved new row shows up in the list coming from the server.
     */
    settle: (result: ActionResult<unknown>, sent: Readonly<Record<string, T>>) => {
      const keys = Object.keys(sent);
      const saved = result.ok ? keys : savedDespiteFailure(keys, result.fieldErrors);
      setErrors(result.ok ? undefined : result.fieldErrors);
      if (saved.length === 0) return;
      const unchangedSince = (key: string, current: T) => saved.includes(key) && sameValues(current, sent[key]!);
      const persisted = saved.filter((key) => !isNewRowKey(key));
      setCommitted((current) => ({ ...current, ...Object.fromEntries(persisted.map((key) => [key, sent[key]!])) }));
      setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([key, draft]) => !unchangedSince(key, draft))));
      setAdded((current) => current.filter((row) => !unchangedSince(row.key, row.value)));
    },
  };
}

/**
 * A single "Kaydet" bar for all changes in a tab, and a warning when leaving without saving.
 *
 * The bar only appears while there are unsaved changes (after saving it briefly shows the result).
 * If a link to another page of the site is clicked while there are changes, a warning dialog opens; if the tab is
 * closed, the page is reloaded or another site is opened, the browser's own warning is shown.
 * There is no autosave.
 */
export function UnsavedChanges({
  count,
  onSave,
  onDiscard,
}: {
  /** Number of unsaved changes. */
  count: number;
  onSave: () => Promise<ActionResult<unknown>>;
  onDiscard: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [leaving, setLeaving] = useState<{ anchor: HTMLAnchorElement; destination: string } | null>(null);
  const [previousCount, setPreviousCount] = useState(count);
  // So the repeated click is not caught by the warning once the user confirms leaving.
  const bypass = useRef(false);
  const dirty = count > 0;

  // If a new change is made after saving the old "saved" message is removed; if all changes are undone
  // the old error message is removed too.
  if (count !== previousCount) {
    setPreviousCount(count);
    if (count > previousCount && feedback?.tone === "success") setFeedback(null);
    if (count === 0 && feedback?.tone === "error") setFeedback(null);
  }

  useEffect(() => {
    if (!dirty) return;
    bypass.current = false;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (bypass.current) return;
      event.preventDefault();
    };
    const onClick = (event: MouseEvent) => {
      if (bypass.current || !(event.target instanceof Element)) return;
      const anchor = event.target.closest("a");
      if (!anchor) return;
      const destination = guardedDestination(
        {
          href: anchor.getAttribute("href"),
          target: anchor.getAttribute("target"),
          download: anchor.hasAttribute("download"),
          button: event.button,
          modifier: event.ctrlKey || event.metaKey || event.shiftKey || event.altKey,
          defaultPrevented: event.defaultPrevented,
        },
        new URL(window.location.href),
      );
      if (!destination) return;
      // Stopped before the link's own handler (Next.js Link) runs.
      event.preventDefault();
      event.stopPropagation();
      setLeaving({ anchor, destination });
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  useEffect(() => {
    if (feedback?.tone !== "success" || dirty) return;
    const timer = window.setTimeout(() => setFeedback(null), SAVED_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [feedback, dirty]);

  const proceed = (target: { anchor: HTMLAnchorElement; destination: string }) => {
    bypass.current = true;
    if (target.anchor.isConnected) target.anchor.click();
    else router.push(target.destination);
  };

  const save = (after?: () => void) => {
    setFeedback(null);
    startTransition(async () => {
      let result: ActionResult<unknown>;
      try {
        result = await onSave();
      } catch (error) {
        // redirect() is propagated as an exception; rethrown so Next.js can handle it.
        if (typeof error === "object" && error !== null && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_")) {
          throw error;
        }
        result = { ok: false, message: "Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyiniz. Değişiklikler kaydedilmedi." };
      }
      setFeedback({ tone: result.ok ? "success" : "error", text: result.message ?? "Değişiklikler kaydedildi." });
      // Always refreshed, so partially saved changes show up on screen as well.
      router.refresh();
      if (result.ok) after?.();
    });
  };

  const visible = dirty || feedback !== null;

  return (
    <>
      {visible ? (
        <>
          {/* So the bar does not cover the last elements of the page. */}
          <div aria-hidden className="h-28 sm:h-20" />
          <div role="region" aria-label="Kaydedilmemiş değişiklikler" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white">
            <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
              <div className="min-w-0 space-y-1">
                {dirty ? (
                  <p className="flex items-center gap-2 text-sm font-medium text-ink">
                    <CircleAlert aria-hidden className="size-5 shrink-0 text-accent-600" />
                    Kaydedilmemiş {count} değişiklik var
                  </p>
                ) : null}
                <ActionFeedback feedback={feedback} />
              </div>
              {dirty ? (
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    disabled={pending}
                    onClick={() => {
                      setFeedback(null);
                      onDiscard();
                    }}
                  >
                    Vazgeç
                  </Button>
                  <Button disabled={pending} onClick={() => save()}>
                    {pending ? "Kaydediliyor…" : "Kaydet"}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      <Dialog
        open={leaving !== null}
        onOpenChange={(open) => {
          if (!open) setLeaving(null);
        }}
        title="Kaydedilmemiş değişiklikleriniz var"
        tone="danger"
        description={`Bu sayfadan ayrılırsanız kaydedilmemiş ${count} değişiklik kaybolur.`}
        footer={
          <>
            <DialogClose className={DIALOG_BUTTON.secondary}>Sayfada kal</DialogClose>
            <button
              type="button"
              className={DIALOG_BUTTON.danger}
              onClick={() => {
                const target = leaving;
                setLeaving(null);
                setFeedback(null);
                onDiscard();
                if (target) proceed(target);
              }}
            >
              Kaydetmeden çık
            </button>
            <button
              type="button"
              className={DIALOG_BUTTON.primary}
              disabled={pending}
              onClick={() => {
                const target = leaving;
                setLeaving(null);
                save(() => {
                  if (target) proceed(target);
                });
              }}
            >
              Kaydet ve devam et
            </button>
          </>
        }
      />
    </>
  );
}
