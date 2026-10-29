"use client";

import type { ReactNode } from "react";
import { Dialog as RadixDialog } from "radix-ui";
import { cn } from "@/components/ui/primitives";
import { figtree } from "@/lib/fonts/figtree";

/**
 * The admin panel's dialog: semi-transparent navy backdrop, 540px,
 * 24px corners, 22px heading, buttons right-aligned. Esc and clicking the backdrop close it; focus stays in the dialog.
 * A dialog taller than the screen scrolls internally; its height is capped minus the top margin, so the buttons at the
 * bottom are never off screen.
 */
export function AdminModal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer: ReactNode;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-dash-navy/35" />
        <RadixDialog.Content
          className={cn(
            figtree.variable,
            "admin-root dash-root fixed left-1/2 top-[max(5vh,1rem)] z-50 flex max-h-[calc(100dvh-max(5vh,1rem)-1rem)] w-[calc(100%-2rem)] max-w-[540px] -translate-x-1/2 flex-col gap-4 overflow-y-auto rounded-[24px] bg-white px-6 py-6 font-dash text-dash-navy shadow-[0_20px_60px_color-mix(in_srgb,var(--color-dash-navy)_25%,transparent)] sm:px-7 sm:py-[26px] min-[700px]:top-[150px] min-[700px]:max-h-[calc(100dvh-150px-1rem)]",
          )}
        >
          <RadixDialog.Title className="text-[22px] font-extrabold tracking-[-0.02em]">{title}</RadixDialog.Title>
          {description ? (
            <RadixDialog.Description asChild>
              <div className="text-[15px] leading-[1.6] text-dash-ink-2">{description}</div>
            </RadixDialog.Description>
          ) : (
            <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
          )}
          {children}
          <div className="flex flex-wrap justify-end gap-2">{footer}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export const ModalClose = RadixDialog.Close;

/** Field label + control inside the dialog (13px bold label). */
/** Labelled field. If `error` is given it is shown below the field with the id `${id}-error` (linked via aria-describedby). */
export function ModalField({ id, label, hint, error, children }: { id: string; label: ReactNode; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-bold">
        {label}
      </label>
      {children}
      {hint ? (
        <span id={`${id}-hint`} className="text-xs font-normal text-dash-ink-3">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={`${id}-error`} role="alert" className="text-xs font-semibold text-dash-red">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** Result of the server action (useServerAction feedback): error in a red box, success in a green box. */
export function ResultMessage({ feedback, className }: { feedback: { tone: "success" | "error"; text: string } | null; className?: string }) {
  if (!feedback) return null;
  return (
    <p
      role={feedback.tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-[14px] px-3.5 py-2.5 text-[13px] font-semibold",
        feedback.tone === "error" ? "bg-dash-red-tint text-dash-red" : "bg-dash-green-tint text-dash-green-ink",
        className,
      )}
    >
      {feedback.text}
    </p>
  );
}
