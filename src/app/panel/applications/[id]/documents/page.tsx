import type { Metadata } from "next";
import { Suspense } from "react";
import { ArrowRight, ExternalLink } from "lucide-react";
import { DocumentChecklist } from "@/components/customer/document-checklist";
import { ExtraDocumentsSection } from "@/components/customer/extra-documents";
import { WizardHeader, WizardShell } from "@/components/customer/wizard/shell";
import { WizardBody, WizardCard, WizardFooter, WizardLoading, wizButtonClass, WizLinkButton, WizNote } from "@/components/customer/wizard/ui";
import { showsExtraDocuments } from "@/features/documents/extra-documents";
import { ALLOWED_FORMATS_TEXT } from "@/features/documents/file-validation";
import { blocksSubmission, documentProgress, needsCustomerAction } from "@/features/documents/rules";
import { customerApplicationPath } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";
import { formatDateTimeTr } from "@/lib/validation/formats";
import { loadApplicationContext, slotState } from "@/server/data/customer";
import { fetchExtraDocuments } from "@/server/data/queries";
import { maxUploadBytes } from "@/server/limits";

export const metadata: Metadata = { title: "Evraklar" };

async function Content({ params }: Pick<PageProps<"/panel/applications/[id]/documents">, "params">) {
  const { id } = await params;
  const ctx = await loadApplicationContext(id);
  const isDraft = ctx.application.status === "draft";
  const maxBytes = maxUploadBytes();
  const missing = ctx.slots.filter((s) => blocksSubmission(slotState(s))).length;
  const progress = documentProgress(ctx.slots.map(slotState));
  // After submission: documents the consultant requested or reported a problem with (gathered at the top of the list).
  const requestedCount = isDraft ? 0 : ctx.slots.filter((s) => needsCustomerAction(slotState(s))).length;
  const extraDocuments = showsExtraDocuments(ctx.application.status) ? await fetchExtraDocuments(await createClient(), id) : [];
  const hasDocuments = ctx.slots.some((s) => !s.outOfScope);

  return (
    <>
      <WizardHeader application={ctx.application} current="documents" steps={ctx.steps} />
      <WizardCard
        eyebrow={isDraft ? "Adım 3 / 6" : undefined}
        title="Evraklar"
        description={
          <p>
            Her belgeyi ayrı ayrı yükleyiniz. Kabul edilen biçimler: {ALLOWED_FORMATS_TEXT}; dosya başına en fazla{" "}
            {Math.round(maxBytes / (1024 * 1024))} MB. Yüklediğiniz belgeleri yalnızca siz ve danışmanlarınız görebilir.
          </p>
        }
      >
        <WizardBody>
          {isDraft && ctx.application.applicationTypes.length === 0 ? (
            <WizNote tone="warning" title="Önce başvuru tipinizi seçiniz">
              <p>İstenen evraklar başvuru tipinize göre belirlenir.</p>
              <WizLinkButton href={customerApplicationPath(id, "type")} size="sm" className="mt-3">
                Başvuru tipini seç
              </WizLinkButton>
            </WizNote>
          ) : null}

          {isDraft && ctx.slots.length > 0 ? (
            missing > 0 ? (
              <WizNote tone="info" role="status">
                <strong className="font-bold">{missing} belge bekleniyor.</strong> Zorunlu belgeleri yüklemeden başvurunuzu gönderemezsiniz.
              </WizNote>
            ) : (
              <WizNote tone="success" role="status">
                Gerekli tüm belgeler tamamlandı.
              </WizNote>
            )
          ) : null}

          {hasDocuments ? (
            <div>
              {/* List of the required documents (PDF): logo at the top, then only the list. */}
              <a href={`/api/applications/${id}/document-checklist`} target="_blank" rel="noopener noreferrer" className={wizButtonClass("secondary", "sm")}>
                Evrak listesi (PDF)
                <ExternalLink aria-hidden className="size-3.5" strokeWidth={2.75} />
                <span className="sr-only"> (yeni sekmede açılır)</span>
              </a>
            </div>
          ) : null}

          {requestedCount > 0 ? (
            <WizNote tone="warning" title={`Danışmanınız sizden ${requestedCount} belge istiyor`} role="status">
              <p>Bu belgeler aşağıda, “Danışmanınızın istediği belgeler” başlığı altında en üsttedir. Her belgedeki açıklamayı okuyup dosyanızı yükleyiniz.</p>
            </WizNote>
          ) : null}

          <DocumentChecklist applicationId={id} status={ctx.application.status} slots={ctx.slots} maxBytes={maxBytes} />

          {showsExtraDocuments(ctx.application.status) ? (
            <ExtraDocumentsSection
              applicationId={id}
              status={ctx.application.status}
              files={extraDocuments.map((file) => ({ id: file.id, originalName: file.originalName, sizeBytes: file.sizeBytes, createdAtText: formatDateTimeTr(file.createdAt) }))}
              limit={ctx.extraDocumentLimit}
              maxBytes={maxBytes}
            />
          ) : null}
        </WizardBody>

        {isDraft ? (
          <WizardFooter
            start={
              progress.total > 0 ? (
                <span className="text-[13px] text-dash-ink-3">
                  {progress.done} / {progress.total} belge tamamlandı
                </span>
              ) : null
            }
            end={
              <>
                <WizLinkButton href={customerApplicationPath(id, "form/additional")} variant="secondary">
                  Geri
                </WizLinkButton>
                <WizLinkButton href={customerApplicationPath(id, "appointment")}>
                  Devam et
                  <ArrowRight aria-hidden className="size-4" strokeWidth={2.75} />
                </WizLinkButton>
              </>
            }
          />
        ) : null}
      </WizardCard>
    </>
  );
}

export default function DocumentsPage({ params }: PageProps<"/panel/applications/[id]/documents">) {
  return (
    <WizardShell>
      <Suspense fallback={<WizardLoading lines={6} />}>
        <Content params={params} />
      </Suspense>
    </WizardShell>
  );
}
