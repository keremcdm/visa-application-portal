import { FileRow, FileUploadButton, type FileItem } from "@/components/documents/file-upload";
import { canAddExtraDocument, EXTRA_DOCUMENT_STATUSES } from "@/features/documents/extra-documents";
import type { ApplicationStatus } from "@/lib/domain/constants";

/**
 * Extra documents after submission: the customer sends extra documents without asking the consultant, up to the
 * limit set in Settings. Documents uploaded at submission do not change; a sent extra document cannot be deleted.
 * The rule is in src/features/documents/extra-documents.ts; the server and the database check the same rule again.
 */
export function ExtraDocumentsSection({
  applicationId,
  status,
  files,
  limit,
  maxBytes,
}: {
  applicationId: string;
  status: ApplicationStatus;
  files: readonly FileItem[];
  limit: number;
  maxBytes: number;
}) {
  const open = EXTRA_DOCUMENT_STATUSES.includes(status);
  // In a closed application only the extra documents already sent are shown; with the feature off and no extra documents there is no section.
  if (files.length === 0 && (!open || limit <= 0)) return null;
  const rule = canAddExtraDocument(status, files.length, limit);

  return (
    <section id="extra-documents" aria-labelledby="extra-documents-heading" className="flex scroll-mt-28 flex-col gap-3 pt-6">
      <h2 id="extra-documents-heading" className="text-xs font-bold uppercase tracking-[0.08em] text-dash-ink-3">
        Ek evraklar
      </h2>
      {open && limit > 0 ? (
        <p className="text-sm leading-normal text-dash-ink-2">
          Başvurunuza eklemek istediğiniz başka bir belge varsa buradan gönderebilirsiniz; danışmanınızdan izin istemeniz gerekmez. Yukarıdaki
          belgeler değiştirilemez ve gönderdiğiniz ek evrak silinemez. En fazla {limit} ek evrak gönderebilirsiniz ({files.length} / {limit}).
        </p>
      ) : null}
      {files.length > 0 ? (
        <ul className="flex w-full flex-col gap-2 lg:max-w-[520px]" aria-label="Gönderdiğiniz ek evraklar">
          {files.map((file) => (
            <FileRow key={file.id} applicationId={applicationId} canDelete={false} look="wizard" file={file} />
          ))}
        </ul>
      ) : null}
      {open && limit > 0 ? (
        <div>
          <FileUploadButton
            applicationId={applicationId}
            target={{ kind: "extra_document" }}
            label="Ek evrak gönder"
            maxBytes={maxBytes}
            disabledReason={rule.ok ? null : rule.message}
            look="wizard"
          />
        </div>
      ) : null}
    </section>
  );
}
