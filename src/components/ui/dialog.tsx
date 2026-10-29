"use client";

import type { ReactNode } from "react";
import { CircleHelp, Info, Trash2, TriangleAlert, X } from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import { figtree } from "@/lib/fonts/figtree";
import { cn } from "./primitives";

/*
 * DIALOG SKELETON
 * Semi-transparent navy backdrop, white card with 28px corners, icon at the top, full-width buttons at the bottom.
 * Dialogs asking for confirmation are centered (file deletion, risky action); informational dialogs are left-aligned with a
 * close button at the top right (form help). Clicking the backdrop and Esc close the dialog; focus is kept inside it.
 */

export type DialogTone = "delete" | "danger" | "neutral" | "help";

/** Icon circle at the top of the dialog: delete (red tint + trash can), risky action (filled red + exclamation). */
export function DialogIcon({ tone }: { tone: DialogTone }) {
  if (tone === "delete")
    return (
      <span aria-hidden className="flex size-16 flex-none items-center justify-center rounded-full bg-dash-red-tint text-dash-red">
        <Trash2 className="size-[26px]" strokeWidth={2.5} />
      </span>
    );
  if (tone === "danger")
    return (
      <span aria-hidden className="flex size-16 flex-none items-center justify-center rounded-full bg-dash-red text-white">
        <TriangleAlert className="size-7" strokeWidth={2.75} />
      </span>
    );
  if (tone === "help")
    return (
      <span aria-hidden className="flex size-12 flex-none items-center justify-center rounded-full bg-dash-navy-tint text-dash-navy">
        <CircleHelp className="size-6" strokeWidth={2.5} />
      </span>
    );
  return (
    <span aria-hidden className="flex size-16 flex-none items-center justify-center rounded-full bg-dash-navy-tint text-dash-navy">
      <Info className="size-7" strokeWidth={2.5} />
    </span>
  );
}

/** Dialog buttons: full width, side by side (stacked on narrow screens). */
export const DIALOG_BUTTON = {
  secondary:
    "inline-flex h-12 flex-[1_1_140px] items-center justify-center whitespace-nowrap rounded-full border-[1.5px] border-dash-field bg-white px-5 text-sm font-bold text-dash-navy transition-colors hover:bg-dash-subtle disabled:cursor-not-allowed disabled:opacity-40",
  primary:
    "inline-flex h-12 flex-[1_1_140px] items-center justify-center whitespace-nowrap rounded-full bg-dash-navy px-5 text-sm font-bold text-white transition-colors hover:bg-dash-navy-hover disabled:cursor-not-allowed disabled:opacity-40",
  danger:
    "inline-flex h-12 flex-[1_1_140px] items-center justify-center whitespace-nowrap rounded-full bg-dash-red px-5 text-sm font-bold text-white transition-colors hover:bg-dash-red-hover disabled:cursor-not-allowed disabled:opacity-40",
} as const;

export function Dialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  footer,
  size = "md",
  tone,
  eyebrow,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg";
  /** Icon at the top; no icon if omitted. "help" is an informational dialog (left-aligned, with a close button). */
  tone?: DialogTone;
  /** Small label above the title (e.g. "Yardım" (help) in the help dialog). */
  eyebrow?: string;
}) {
  // Dialogs asking for confirmation (with buttons) are centered; informational dialogs are left-aligned with a close button at the top right.
  const centered = Boolean(footer) && tone !== "help";
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger> : null}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-dash-navy/45" />
        <RadixDialog.Content
          className={cn(
            figtree.variable,
            "dash-root fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-[18px] overflow-y-auto rounded-[28px] bg-white p-6 font-dash text-dash-ink shadow-[0_24px_60px_color-mix(in_srgb,var(--color-dash-navy)_25%,transparent)] sm:p-8",
            size === "lg" ? "max-w-[560px]" : centered ? "max-w-[420px]" : "max-w-[480px]",
            centered ? "items-center text-center" : null,
          )}
        >
          {centered ? null : (
            <RadixDialog.Close
              className="absolute right-[18px] top-[18px] inline-flex size-9 items-center justify-center rounded-full bg-dash-subtle text-dash-ink-2 transition-colors hover:bg-dash-line-soft hover:text-dash-navy"
              aria-label="Pencereyi kapat"
            >
              <X aria-hidden className="size-[18px]" strokeWidth={2.5} />
            </RadixDialog.Close>
          )}
          {tone ? <DialogIcon tone={tone} /> : null}
          <div className={cn("flex flex-col gap-1.5", centered ? null : "pr-10")}>
            {eyebrow ? <p className="text-xs font-bold uppercase tracking-[0.08em] text-dash-ink-3">{eyebrow}</p> : null}
            <RadixDialog.Title className="text-xl font-extrabold leading-snug">{title}</RadixDialog.Title>
            {description ? (
              <RadixDialog.Description asChild>
                <div className="text-sm leading-[1.55] text-dash-ink-2 [text-wrap:pretty]">{description}</div>
              </RadixDialog.Description>
            ) : (
              <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
            )}
          </div>
          {children ? <div className="w-full text-left">{children}</div> : null}
          {footer ? <div className="flex w-full flex-wrap gap-2.5">{footer}</div> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export const DialogClose = RadixDialog.Close;
