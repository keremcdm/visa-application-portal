"use client";

import { useState } from "react";
import { Check, Download, ExternalLink, X } from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import { wizButtonClass } from "@/components/customer/wizard/ui";
import { DIALOG_BUTTON } from "@/components/ui/dialog";
import { cn } from "@/components/ui/primitives";
import { figtree } from "@/lib/fonts/figtree";
import { VISA_OUTCOME_LABELS, type VisaOutcome } from "@/lib/domain/constants";

export type VisaOutcomeView = {
  outcome: VisaOutcome;
  note: string | null;
  atText: string;
  file: { id: string; isImage: boolean } | null;
};

/**
 * The customer's "Başvuru sonucunu göster" (show application result) button and the dialog showing the result. The
 * competent authority makes the decision; the company only passes it on. The look follows the design language: large green
 * tick / red cross, heading, notification date, note box, document and "Kapat" (close). On the status page it opens
 * automatically when the page opens (`defaultOpen`); on the home page it opens with the button.
 */
export function VisaOutcomeDialog({
  result,
  buttonLabel = "Başvuru sonucunu göster",
  triggerClassName,
  defaultOpen = false,
}: {
  result: VisaOutcomeView;
  buttonLabel?: string;
  /** Look of the button (e.g. a bordered white pill on the navy card on the home page). */
  triggerClassName?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const fileUrl = result.file ? `/api/files/${result.file.id}` : null;
  const approved = result.outcome === "approved";

  return (
    <RadixDialog.Root open={open} onOpenChange={setOpen}>
      <RadixDialog.Trigger asChild>
        <button type="button" className={triggerClassName ?? wizButtonClass("primary", "lg")}>
          {buttonLabel}
        </button>
      </RadixDialog.Trigger>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-dash-navy/45" />
        <RadixDialog.Content
          className={cn(
            figtree.variable,
            "dash-root fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-[18px] overflow-y-auto rounded-[28px] bg-white p-6 text-center font-dash text-dash-ink shadow-[0_24px_60px_color-mix(in_srgb,var(--color-dash-navy)_25%,transparent)] sm:p-8",
          )}
        >
          <span
            aria-hidden
            className={cn("flex size-[72px] flex-none items-center justify-center rounded-full text-white", approved ? "bg-dash-green" : "bg-dash-red")}
          >
            {approved ? <Check className="size-8" strokeWidth={3.5} /> : <X className="size-[30px]" strokeWidth={3.5} />}
          </span>
          <div className="flex flex-col gap-1.5">
            <RadixDialog.Title className="text-[22px] font-extrabold leading-snug tracking-[-0.01em]">{VISA_OUTCOME_LABELS[result.outcome]}</RadixDialog.Title>
            <RadixDialog.Description asChild>
              <div className="flex flex-col gap-1 text-[13px] text-dash-ink-3">
                <p>Bildirim tarihi: {result.atText}</p>
                <p>Vize kararı yetkili makam tarafından verilmiştir.</p>
              </div>
            </RadixDialog.Description>
          </div>

          {result.note ? (
            <div className="flex w-full flex-col gap-1 rounded-[16px] bg-dash-canvas px-4 py-3.5 text-left">
              <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-dash-ink-3">{approved ? "Danışmanınızın notu" : "Ret sebebi"}</h3>
              <p className="whitespace-pre-line text-sm leading-[1.55]">{result.note}</p>
            </div>
          ) : null}

          {fileUrl ? (
            <div className="flex w-full flex-col gap-2 text-left">
              <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-dash-ink-3">Sonucun ekran görüntüsü</h3>
              {result.file?.isImage ? (
                // The file is served via a short-lived signed URL after the session is verified; a plain <img> is used because
                // next/image would try to fetch it on the server without a session.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={fileUrl} alt="Vize sonucunun ekran görüntüsü" className="max-h-[40vh] w-full rounded-[18px] border border-dash-line-soft object-contain" />
              ) : null}
            </div>
          ) : null}

          <div className="flex w-full flex-wrap gap-2.5">
            {fileUrl ? (
              <>
                <a href={`${fileUrl}?download=1`} className={cn(DIALOG_BUTTON.primary, "gap-2")}>
                  <Download aria-hidden className="size-4" strokeWidth={2.75} />
                  İndir
                </a>
                <a href={fileUrl} target="_blank" rel="noopener" className={cn(DIALOG_BUTTON.secondary, "gap-2")}>
                  <ExternalLink aria-hidden className="size-4" strokeWidth={2.5} />
                  Yeni sekmede aç
                </a>
              </>
            ) : null}
            <RadixDialog.Close className={fileUrl ? DIALOG_BUTTON.secondary : DIALOG_BUTTON.primary}>Kapat</RadixDialog.Close>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
