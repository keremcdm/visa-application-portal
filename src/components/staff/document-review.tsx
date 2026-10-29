"use client";

import { useState } from "react";
import { FileRow, FileUploadButton, type FileItem } from "@/components/documents/file-upload";
import { DocumentReviewBadge, RequirementBadge } from "@/components/status-badges";
import { ActionButton, ActionFeedback, useServerAction } from "@/components/ui/action-button";
import { Dialog, DIALOG_BUTTON, DialogClose } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { Badge, Button, Card } from "@/components/ui/primitives";
import type { DocumentRequirement, DocumentReviewStatus } from "@/lib/domain/constants";
import { documentAnchor } from "@/lib/site";
import { approveDocumentAction, removeDocumentRequestAction, reportDocumentProblemAction } from "@/server/actions/staff";

export type ReviewSlot = {
  id: string;
  label: string;
  description: string;
  requirement: DocumentRequirement;
  isCustomRequest: boolean;
  outOfScope: boolean;
  reviewStatus: DocumentReviewStatus;
  reviewNote: string | null;
  zipFolderName: string | null;
  attachment: FileItem | null;
  files: FileItem[];
  maxFiles: number;
};

/** "Sorun bildir" (report a problem): the note is required; the customer is notified and can upload the document again. */
function ReportProblemButton({ applicationId, slotId, label, hasFiles }: { applicationId: string; slotId: string; label: string; hasFiles: boolean }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const { pending, feedback, run, setFeedback } = useServerAction();
  const fieldId = `problem-${slotId}`;
  const error = feedback?.tone === "error" ? feedback.text : null;
  return (
    <div className="inline-flex flex-col items-start gap-1.5">
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setFeedback(null);
        }}
        trigger={
          <Button size="sm" variant="secondary">
            Sorun bildir
          </Button>
        }
        title="Müşteriye sorun bildir"
        description={
          <p>
            “{label}” {hasFiles ? "belgesinde düzeltme istenecek" : "belgesi eksik olarak bildirilecek"}. Müşteri bildirim alır, notunuzu görür ve belgeyi
            yeniden yükleyebilir. Başvuru, müşteri tamamlayana kadar “Müşteriden işlem bekleniyor” aşamasında kalır.
          </p>
        }
        footer={
          <>
            <DialogClose className={DIALOG_BUTTON.secondary}>Vazgeç</DialogClose>
            <button
              type="button"
              className={DIALOG_BUTTON.primary}
              disabled={pending || note.trim() === ""}
              onClick={() =>
                run(
                  () => reportDocumentProblemAction(applicationId, slotId, note),
                  () => {
                    setOpen(false);
                    setNote("");
                  },
                )
              }
            >
              {pending ? "Gönderiliyor…" : "Sorunu bildir"}
            </button>
          </>
        }
      >
        <Field id={fieldId} label="Müşteriye not" required hint="Müşterinin ne yapması gerektiğini yazınız." error={error}>
          <Textarea
            id={fieldId}
            value={note}
            maxLength={1000}
            rows={3}
            autoFocus
            onChange={(e) => setNote(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${fieldId}-hint ${fieldId}-error` : `${fieldId}-hint`}
          />
        </Field>
      </Dialog>
      {feedback?.tone === "success" ? <ActionFeedback feedback={feedback} /> : null}
    </div>
  );
}

/**
 * Card where the consultant reviews a single document slot. The review is done with two buttons and applies immediately:
 * "Uygun" (approved) and "Sorun bildir". Adding files and removing a request also apply immediately.
 */
export function DocumentReviewCard({
  applicationId,
  slot,
  maxBytes,
  reviewable,
}: {
  applicationId: string;
  slot: ReviewSlot;
  maxBytes: number;
  /** Is the application submitted? Documents are not reviewed in a draft. */
  reviewable: boolean;
}) {
  const problem = slot.reviewStatus === "needs_correction" || slot.reviewStatus === "missing";
  return (
    // The "Belgeyi görüntüle" (view document) link on the application's General tab targets and highlights this card.
    <div id={documentAnchor(slot.id)} className="scroll-mt-6 rounded-[22px] target:ring-2 target:ring-dash-yellow-accent">
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-ink">{slot.label}</h3>
          {slot.description ? <p className="mt-1 text-sm leading-6 text-muted">{slot.description}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {slot.isCustomRequest ? <Badge tone="info">Özel istek</Badge> : null}
          {slot.outOfScope ? <Badge>Başvuru tipinde istenmiyor</Badge> : <RequirementBadge requirement={slot.requirement} />}
          <DocumentReviewBadge status={slot.reviewStatus} />
        </div>
      </div>

      <p className="mt-2 text-sm text-muted">
        ZIP klasörü: {slot.zipFolderName ? <span className="font-medium text-ink">{slot.zipFolderName}</span> : "eşleştirilmemiş (kök dizin)"}
      </p>

      {problem && slot.reviewNote ? (
        <div className="mt-3 rounded-md border border-accent-100 bg-accent-50 px-3 py-2 text-sm text-accent-700">
          Müşteriye bildirilen sorun: “{slot.reviewNote}”
        </div>
      ) : null}

      {slot.files.length > 0 ? (
        <ul className="mt-4 space-y-2" aria-label={`${slot.label} için yüklenen dosyalar`}>
          {slot.files.map((file) => (
            <FileRow key={file.id} applicationId={applicationId} file={file} canDelete showDownload />
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted">Dosya yüklenmedi.</p>
      )}

      {slot.attachment ? (
        // Document sent to the customer: view, download and delete.
        <div className="mt-3 rounded-md border border-brand-200 bg-brand-50 px-3 py-2">
          <p className="mb-2 text-sm font-semibold text-brand-900">Müşteriye gönderilen belge</p>
          <ul aria-label={`${slot.label} için müşteriye gönderilen belge`}>
            <FileRow applicationId={applicationId} file={slot.attachment} canDelete showDownload />
          </ul>
        </div>
      ) : null}

      {reviewable && !slot.outOfScope ? (
        <div className="mt-4 flex flex-wrap items-start gap-3 border-t border-line pt-4">
          <ActionButton size="sm" disabled={slot.reviewStatus === "approved"} action={() => approveDocumentAction(applicationId, slot.id)}>
            {slot.reviewStatus === "approved" ? "Uygun olarak işaretli" : "Uygun"}
          </ActionButton>
          <ReportProblemButton applicationId={applicationId} slotId={slot.id} label={slot.label} hasFiles={slot.files.length > 0} />
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-start gap-4 border-t border-line pt-4">
        {/* The difference between the two buttons is spelled out in their names and the description below. */}
        <div className="flex max-w-[22rem] flex-col gap-1.5">
          <FileUploadButton
            applicationId={applicationId}
            target={{ kind: "document", documentId: slot.id }}
            label="Müşterinin yerine dosya yükle"
            maxBytes={maxBytes}
            disabledReason={slot.files.length >= slot.maxFiles ? `En fazla ${slot.maxFiles} dosya yüklenebilir.` : null}
          />
          <p className="text-xs text-muted">Müşteri bu belgeyi size e-postayla veya elden verdiyse buradan yükleyin; müşterinin yüklediği dosyalar arasına eklenir.</p>
        </div>
        {slot.isCustomRequest ? (
          <div className="flex max-w-[22rem] flex-col gap-1.5">
            <FileUploadButton
              applicationId={applicationId}
              target={{ kind: "staff_attachment", documentId: slot.id }}
              label={slot.attachment ? "Müşteriye gönderilen belgeyi değiştir" : "Müşteriye indirmesi için belge gönder"}
              maxBytes={maxBytes}
            />
            <p className="text-xs text-muted">Müşterinin indirip dolduracağı veya imzalayacağı bir belge (ör. form şablonu). Müşteri bu istekte belgeyi indirir, doldurup geri yükler.</p>
          </div>
        ) : null}
        {slot.isCustomRequest && slot.files.length === 0 ? (
          <ActionButton
            variant="ghost"
            size="sm"
            action={removeDocumentRequestAction.bind(null, applicationId, slot.id)}
            confirm={{ title: "Belge isteği kaldırılsın mı?", description: `“${slot.label}” isteği müşterinin listesinden kaldırılacak.`, confirmLabel: "İsteği kaldır", tone: "delete" }}
          >
            İsteği kaldır
          </ActionButton>
        ) : null}
      </div>
    </Card>
    </div>
  );
}
