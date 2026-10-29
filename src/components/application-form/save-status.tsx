"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { cn } from "@/components/ui/primitives";

/** The form's save state: produced by SectionForm, read by the indicator in the page header. */
export type SaveStatus =
  | { kind: "idle" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "error"; message: string };

const SaveStatusContext = createContext<{ status: SaveStatus; setStatus: (status: SaveStatus) => void } | null>(null);

/** Provider wrapping the header and the form on the application form page. */
export function SaveStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  return <SaveStatusContext.Provider value={{ status, setStatus }}>{children}</SaveStatusContext.Provider>;
}

/** Passes the form's save state to the header indicator (does nothing without a provider). */
export function useReportSaveStatus(status: SaveStatus) {
  const context = useContext(SaveStatusContext);
  const setStatus = context?.setStatus;
  useEffect(() => {
    setStatus?.(status);
  }, [setStatus, status]);
}

/**
 * Autosave indicator to the right of the page heading: green dot and
 * "Kaydedildi · SS:DD" (saved · HH:MM). Green only when actually saved; unsaved changes are yellow, errors red.
 * The error details and "Tekrar dene" (try again) are in the form's bottom bar.
 */
export function SaveIndicator() {
  const context = useContext(SaveStatusContext);
  if (!context) return null;
  const { status } = context;
  const dot =
    status.kind === "error" ? "bg-dash-red" : status.kind === "dirty" ? "bg-dash-yellow" : status.kind === "saving" ? "bg-dash-dot" : "bg-dash-green";
  const text =
    status.kind === "saved"
      ? `Kaydedildi · ${status.at}`
      : status.kind === "saving"
        ? "Kaydediliyor…"
        : status.kind === "dirty"
          ? "Kaydedilmemiş değişiklikler var"
          : status.kind === "error"
            ? "Kaydedilemedi"
            : "Tüm değişiklikler kaydedildi";
  return (
    <p className={cn("flex items-center gap-2 text-[13px]", status.kind === "error" ? "font-semibold text-dash-red" : "text-dash-ink-3")} aria-live="polite">
      <span aria-hidden className={cn("size-[7px] flex-none rounded-full", dot)} />
      {text}
    </p>
  );
}
