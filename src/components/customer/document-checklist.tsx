import { Download } from "lucide-react";
import { FileRow, FileUploadButton } from "@/components/documents/file-upload";
import {
  canCustomerDeleteFile,
  canCustomerModifyDocument,
  canCustomerUpload,
  customerDocumentAlert,
  documentCompletion,
  needsCustomerAction,
} from "@/features/documents/rules";
import { DOCUMENT_REVIEW_STATUS_LABELS, type ApplicationStatus, type DocumentReviewStatus } from "@/lib/domain/constants";
import { REQUESTED_DOCUMENTS_ANCHOR } from "@/features/notifications/page";
import { documentAnchor } from "@/lib/site";
import { formatDateTimeTr } from "@/lib/validation/formats";
import { slotState } from "@/server/data/customer";
import type { DocumentSlot } from "@/server/data/types";
import { RequirementTag, StatusPill, wizButtonClass, WizNote, type PillTone } from "./wizard/ui";

function CompletionPill({ slot }: { slot: DocumentSlot }) {
  const completion = documentCompletion(slotState(slot));
  if (completion === "complete") return <StatusPill tone="done">Yüklendi</StatusPill>;
  if (completion === "missing") return <StatusPill tone="waiting">Bekleniyor</StatusPill>;
  if (completion === "out_of_scope") return <StatusPill tone="neutral">Bu başvuru tipinde istenmiyor</StatusPill>;
  return <StatusPill tone="neutral">Yüklenmedi</StatusPill>;
}

const REVIEW_PILLS: Record<DocumentReviewStatus, PillTone> = {
  pending: "neutral",
  approved: "done",
  needs_correction: "warning",
  missing: "danger",
};

/** A single document row: name, description and status on the left; uploaded files and actions on the right. */
function DocumentRow({
  applicationId,
  status,
  slot,
  maxBytes,
}: {
  applicationId: string;
  status: ApplicationStatus;
  slot: DocumentSlot;
  maxBytes: number;
}) {
  const state = slotState(slot);
  const modifiable = canCustomerModifyDocument(status, state);
  const upload = canCustomerUpload(status, state);
  const canDelete = canCustomerDeleteFile(status, state).ok;
  const reviewVisible = status !== "draft" && slot.files.length > 0;
  const alert = customerDocumentAlert(status, state, slot.reviewNote);

  return (
    // The id lets the link in "Yapmanız gerekenler" (what you need to do) jump straight to this document; the target is lightly highlighted.
    <li
      id={documentAnchor(slot.id)}
      className="-mx-3 flex scroll-mt-28 flex-wrap items-start justify-between gap-x-6 gap-y-4 rounded-[16px] border-b border-dash-line-soft px-3 py-6 target:bg-dash-red-tint"
    >
      <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 className="text-base font-bold">{slot.label}</h3>
          {slot.outOfScope ? null : <RequirementTag requirement={slot.requirement} />}
        </div>
        {slot.description ? <p className="text-sm leading-normal text-dash-ink-2">{slot.description}</p> : null}
        <div className="mt-1.5 flex flex-wrap gap-2">
          <CompletionPill slot={slot} />
          {reviewVisible ? <StatusPill tone={REVIEW_PILLS[slot.reviewStatus]}>{DOCUMENT_REVIEW_STATUS_LABELS[slot.reviewStatus]}</StatusPill> : null}
        </div>

        {alert ? (
          <WizNote tone="danger" title={alert.title} className="mt-2.5">
            {alert.note ? <p className="whitespace-pre-line">{alert.note}</p> : <p>Açıklamayı okuyup belgeyi aşağıdaki düğmeyle yükleyiniz.</p>}
          </WizNote>
        ) : null}

        {slot.attachment ? (
          <WizNote tone="info" className="mt-2.5">
            <p>Danışmanınız bu işlem için bir belge hazırladı. Belgeyi indirip gerekli işlemi (ör. imza) yaptıktan sonra buraya yükleyiniz.</p>
            <a href={`/api/files/${slot.attachment.id}?download=1`} className={wizButtonClass("secondary", "sm", "mt-3")}>
              <Download aria-hidden className="size-4" strokeWidth={2.5} />
              Hazırlanan belgeyi indir
            </a>
          </WizNote>
        ) : null}

        {slot.outOfScope ? (
          <p className="mt-1.5 text-sm leading-normal text-dash-ink-2">
            Bu belgeyi daha önce yüklediniz ancak seçtiğiniz başvuru tipinde istenmiyor. Dilerseniz silebilirsiniz; silmezseniz danışmanınız
            görebilir.
          </p>
        ) : null}
      </div>

      <div className="flex w-full flex-col items-start gap-3 lg:w-auto lg:max-w-[340px] lg:items-end">
        {slot.files.length > 0 ? (
          <ul className="flex w-full flex-col gap-2 lg:w-[340px]" aria-label={`${slot.label} için yüklenen dosyalar`}>
            {slot.files.map((file) => (
              <FileRow
                key={file.id}
                applicationId={applicationId}
                canDelete={canDelete}
                look="wizard"
                file={{ id: file.id, originalName: file.originalName, sizeBytes: file.sizeBytes, createdAtText: formatDateTimeTr(file.createdAt) }}
              />
            ))}
          </ul>
        ) : null}

        {slot.outOfScope ? null : (
          <>
            {modifiable ? (
              <FileUploadButton
                applicationId={applicationId}
                target={{ kind: "document", documentId: slot.id }}
                label={slot.files.length > 0 ? "Başka dosya ekle" : "Dosya yükle"}
                maxBytes={maxBytes}
                disabledReason={upload.ok ? null : upload.message}
                look="wizard"
              />
            ) : null}
            {!modifiable && slot.files.length === 0 ? (
              <p className="text-[13px] leading-normal text-dash-ink-3 lg:text-right">
                Bu belge için şu anda yükleme yapılamaz. Gerekirse danışmanınız sizden talep edecektir.
              </p>
            ) : null}
          </>
        )}
      </div>
    </li>
  );
}

export function DocumentChecklist({
  applicationId,
  status,
  slots,
  maxBytes,
}: {
  applicationId: string;
  status: ApplicationStatus;
  slots: DocumentSlot[];
  maxBytes: number;
}) {
  const active = slots.filter((s) => !s.outOfScope);
  // Documents the consultant requested later or reported a problem with are gathered at the top; the customer does not have to search.
  const isRequested = (s: DocumentSlot) => s.requestedByStaff || (status !== "draft" && needsCustomerAction(slotState(s)));
  const requested = active.filter(isRequested);
  const standard = active.filter((s) => !isRequested(s));
  const outOfScope = slots.filter((s) => s.outOfScope);

  const section = (title: string, items: DocumentSlot[], id?: string) =>
    items.length > 0 ? (
      <section id={id} className="flex scroll-mt-28 flex-col">
        <h2 className="pb-1.5 text-xs font-bold uppercase tracking-[0.08em] text-dash-ink-3">{title}</h2>
        <ul>
          {items.map((slot) => (
            <DocumentRow key={slot.id} applicationId={applicationId} status={status} slot={slot} maxBytes={maxBytes} />
          ))}
        </ul>
      </section>
    ) : null;

  return (
    <>
      {/* Notification and e-mail links land on this section (#requested-documents). */}
      {section("Danışmanınızın istediği belgeler", requested, REQUESTED_DOCUMENTS_ANCHOR)}
      {section("İstenen evraklar", standard)}
      {section("Başvuru tipinize ait olmayan yüklenmiş belgeler", outOfScope)}
    </>
  );
}
