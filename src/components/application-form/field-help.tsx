"use client";

import Image from "next/image";
import { CircleHelp, ImageOff } from "lucide-react";
import { Dialog, DIALOG_BUTTON, DialogClose } from "@/components/ui/dialog";
import { FORM_HELP_IMAGE_DIR, type FieldHelp } from "@/features/application-form/help";

/**
 * Question mark button next to a field label and the help dialog it opens.
 * If the image file has not been added yet, a descriptive placeholder is shown instead of a broken image.
 */
export function FieldHelpButton({ help, imageAvailable, fieldLabel }: { help: FieldHelp; imageAvailable: boolean; fieldLabel: string }) {
  return (
    <Dialog
      title={help.title}
      tone="help"
      // The top label and the large close button from the design.
      eyebrow="Yardım"
      footer={<DialogClose className={DIALOG_BUTTON.primary}>Anladım</DialogClose>}
      trigger={
        <button
          type="button"
          className="inline-flex size-6 items-center justify-center rounded-full text-dash-ink-3 hover:bg-dash-subtle hover:text-dash-navy"
          aria-label={`“${fieldLabel}” alanı için yardım`}
        >
          <CircleHelp aria-hidden className="size-[1.125rem]" />
        </button>
      }
      description={<p>{help.description}</p>}
    >
      {help.image ? (
        imageAvailable ? (
          <Image
            src={`${FORM_HELP_IMAGE_DIR}/${help.image}`}
            alt={help.imageAlt ?? help.title}
            width={960}
            height={640}
            sizes="(min-width: 640px) 40rem, 100vw"
            className="h-auto w-full rounded-[18px] bg-dash-canvas"
          />
        ) : (
          <div className="flex items-center gap-3 rounded-[18px] bg-dash-canvas px-4 py-5 text-sm text-dash-ink-3">
            <ImageOff aria-hidden className="size-5 shrink-0" strokeWidth={2.5} />
            <p>Bu alan için açıklayıcı görsel henüz eklenmedi.</p>
          </div>
        )
      ) : null}
    </Dialog>
  );
}
