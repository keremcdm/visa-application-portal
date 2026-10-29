"use client";

import { useState } from "react";
import { ActionButton, ActionFeedback, useServerAction } from "@/components/ui/action-button";
import { Dialog, DIALOG_BUTTON, DialogClose } from "@/components/ui/dialog";
import { describedBy, Textarea } from "@/components/ui/form";
import { FORM_EDIT_NOTE_MAX, type FormEditState } from "@/features/applications/form-edit";
import { finishFormCorrectionAction, requestFormEditAction } from "@/server/actions/applications";
import { wizButtonClass, WizField, WizNote } from "./wizard/ui";

/**
 * EDITING THE FORM OF A SUBMITTED APPLICATION
 *  - While the form is open for correction: "Formu düzenlemeyi tamamladım" (I finished editing; the form locks, the correction notice disappears).
 *  - While the request is with the consultant: the request text and a waiting notice.
 *  - While the form is locked: "Formda değişiklik yapmak istiyorum" (a request is sent telling the consultant what will change).
 * The rule is in src/features/applications/form-edit.ts; the server and the database check the same rule again.
 */

/** "Formu düzenlemeyi tamamladım" button (with a confirmation dialog). */
export function FinishFormCorrectionButton({ applicationId, size = "md" }: { applicationId: string; size?: "md" | "row" }) {
  return (
    <ActionButton
      buttonClassName={wizButtonClass("primary", size)}
      feedbackClassName="text-xs"
      action={finishFormCorrectionAction.bind(null, applicationId)}
      confirm={{
        title: "Formu düzenlemeyi tamamladınız mı?",
        description: "Düzeltmeleriniz danışmanınıza iletilir ve form yeniden düzenlemeye kapanır. Sonradan değişiklik gerekirse danışmanınızdan yeniden isteyebilirsiniz.",
        confirmLabel: "Evet, tamamladım",
      }}
    >
      Formu düzenlemeyi tamamladım
    </ActionButton>
  );
}

function RequestFormEditDialog({ applicationId }: { applicationId: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const { pending, feedback, run, setFeedback } = useServerAction();
  const id = `form-edit-note-${applicationId}`;

  // The note is optional.
  const send = () => {
    run(
      () => requestFormEditAction(applicationId, note.trim()),
      () => {
        setOpen(false);
        setNote("");
      },
    );
  };

  return (
    <div className="flex flex-col items-start gap-1.5">
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setFeedback(null);
        }}
        trigger={
          <button type="button" className={wizButtonClass("secondary", "md")}>
            Formda değişiklik yapmak istiyorum
          </button>
        }
        title="Form düzenleme isteği"
        description="İsterseniz danışmanınıza formda neyi değiştirmek istediğinizi yazabilirsiniz. Danışmanınız formu düzenlemeye açtığında size bildirim gelir."
        footer={
          <>
            <DialogClose className={DIALOG_BUTTON.secondary}>Vazgeç</DialogClose>
            <button type="button" className={DIALOG_BUTTON.primary} disabled={pending} onClick={send}>
              {pending ? "Gönderiliyor…" : "İsteği gönder"}
            </button>
          </>
        }
      >
        <div className="wiz-root flex flex-col gap-3">
          <WizField id={id} label="Neyi değiştirmek istiyorsunuz? (isteğe bağlı)" hint="Örnek: İletişim bilgilerimdeki adresim değişti.">
            <Textarea
              id={id}
              rows={4}
              maxLength={FORM_EDIT_NOTE_MAX}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-describedby={describedBy(id, true, undefined)}
            />
          </WizField>
          {feedback?.tone === "error" ? <ActionFeedback feedback={feedback} className="text-[13px]" /> : null}
        </div>
      </Dialog>
      {feedback?.tone === "success" ? <ActionFeedback feedback={feedback} className="text-[13px]" /> : null}
    </div>
  );
}

export function FormEditControls({ applicationId, state, requestNote }: { applicationId: string; state: FormEditState; requestNote: string | null }) {
  switch (state) {
    case "open":
      return (
        <WizNote tone="info" title="Formunuz düzeltme için açık">
          <p>Danışmanınız formunuzu düzenlemeniz için açtı. İlgili bölümün yanındaki “Düzenle” bağlantısıyla düzeltmeleri yapınız.</p>
          <p className="mt-1.5">Bitirdiğinizde aşağıdaki düğmeye basınız; düzeltmeleriniz danışmanınıza iletilir ve form yeniden kapanır.</p>
          <div className="mt-3">
            <FinishFormCorrectionButton applicationId={applicationId} />
          </div>
        </WizNote>
      );
    case "requested":
      return (
        <WizNote tone="info" title="Form düzenleme isteğiniz danışmanınıza iletildi" role="status">
          {requestNote ? <p className="whitespace-pre-line">İsteğiniz: {requestNote}</p> : null}
          <p className="mt-1.5">Danışmanınız formu düzenlemeye açtığında veya isteğinizi yanıtladığında size bildirim gelecektir.</p>
        </WizNote>
      );
    case "can_request":
      return (
        <div className="flex flex-col gap-2">
          <p className="text-sm leading-[1.6] text-dash-ink-2">
            Gönderdiğiniz formda bir bilgiyi değiştirmeniz gerekiyorsa danışmanınızdan formu düzenlemeye açmasını isteyebilirsiniz.
          </p>
          <RequestFormEditDialog applicationId={applicationId} />
        </div>
      );
    case "closed":
      return null;
  }
}
