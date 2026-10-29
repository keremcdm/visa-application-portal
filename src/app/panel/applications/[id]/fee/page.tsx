import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ArrowRight } from "lucide-react";
import { BankTransferInfo } from "@/components/customer/bank-transfer-info";
import { FeeStepSeen } from "@/components/customer/fee-step-seen";
import { WizardHeader, WizardShell } from "@/components/customer/wizard/shell";
import { WizardBody, WizardCard, WizardFooter, WizardLoading, WizLinkButton } from "@/components/customer/wizard/ui";
import { FileRow, FileUploadButton } from "@/components/documents/file-upload";
import { customerApplicationPath } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";
import { formatDateTimeTr } from "@/lib/validation/formats";
import { loadApplicationContext } from "@/server/data/customer";
import { fetchReceipts } from "@/server/data/queries";
import { maxUploadBytes } from "@/server/limits";

export const metadata: Metadata = { title: "Ücret" };

/**
 * Reminder page: no price is shown (the fee is agreed with the consultant separately).
 * Bank details are shown and a receipt can optionally be uploaded; this step does not block submission.
 */
async function Content({ params }: Pick<PageProps<"/panel/applications/[id]/fee">, "params">) {
  const { id } = await params;
  const ctx = await loadApplicationContext(id);
  if (ctx.application.status !== "draft") redirect(customerApplicationPath(id));
  const receipts = await fetchReceipts(await createClient(), id);

  return (
    <>
      {ctx.application.feeStepSeenAt ? null : <FeeStepSeen applicationId={id} />}
      <WizardHeader application={ctx.application} current="fee" steps={ctx.steps} />
      <WizardCard
        eyebrow="Adım 5 / 6"
        title="Ücret"
        description={
          <p>
            Danışmanımızla anlaştığınız ücreti aşağıdaki hesaba banka havalesiyle ödeyebilir, dekontunu buraya yükleyebilirsiniz. Dekont
            yüklemek zorunlu değildir; yüklemeden de sonraki adıma geçip başvurunuzu tamamlayabilirsiniz.
          </p>
        }
      >
        <WizardBody>
          <div className="flex flex-wrap items-stretch gap-6">
            <div className="min-w-0 flex-[1_1_440px] rounded-[24px] bg-dash-canvas p-5 sm:p-8">
              <BankTransferInfo payment={ctx.payment} look="wizard" />
            </div>

            <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-3.5">
              <h2 className="text-base font-bold">Banka dekontu (isteğe bağlı)</h2>
              {receipts.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {receipts.map((file) => (
                    <FileRow
                      key={file.id}
                      applicationId={id}
                      canDelete
                      look="wizard"
                      file={{ id: file.id, originalName: file.originalName, sizeBytes: file.sizeBytes, createdAtText: formatDateTimeTr(file.createdAt) }}
                    />
                  ))}
                </ul>
              ) : null}
              {ctx.payment.receiptUploadEnabled ? (
                <FileUploadButton
                  applicationId={id}
                  target={{ kind: "payment_receipt" }}
                  label="Dekont yükle"
                  maxBytes={maxUploadBytes()}
                  look="dropzone"
                  className={receipts.length > 0 ? "min-h-[150px]" : "min-h-[220px]"}
                />
              ) : (
                <p className="text-sm leading-[1.6] text-dash-ink-2">
                  Dekont yükleme şu anda kapalıdır. Dekontunuzu danışmanınıza ayrıca iletebilirsiniz.
                </p>
              )}
            </div>
          </div>
        </WizardBody>

        <WizardFooter
          start={
            <WizLinkButton href={customerApplicationPath(id, "appointment")} variant="secondary">
              Geri
            </WizLinkButton>
          }
          end={
            <WizLinkButton href={customerApplicationPath(id, "summary")}>
              Devam et
              <ArrowRight aria-hidden className="size-4" strokeWidth={2.75} />
            </WizLinkButton>
          }
        />
      </WizardCard>
    </>
  );
}

export default function FeesPage({ params }: PageProps<"/panel/applications/[id]/fee">) {
  return (
    <WizardShell>
      <Suspense fallback={<WizardLoading />}>
        <Content params={params} />
      </Suspense>
    </WizardShell>
  );
}
