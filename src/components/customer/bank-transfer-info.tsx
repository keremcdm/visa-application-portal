import type { ReactNode } from "react";
import { Landmark } from "lucide-react";
import type { PaymentInfo } from "@/server/data/types";
import { CopyButton } from "./wizard/copy-button";
import { WizNote } from "./wizard/ui";

function WizardItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <dt className="text-xs font-bold uppercase tracking-[0.08em] text-dash-ink-3">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** Look in the application steps: grey panel, bank icon, large IBAN. Same content. */
function WizardBankTransferInfo({ payment, compact }: { payment: PaymentInfo; compact: boolean }) {
  return (
    <div className={compact ? "flex flex-col gap-[18px]" : "flex flex-col gap-7"}>
      {compact ? (
        // Application status page: icon and heading side by side.
        <div className="flex items-center gap-3.5">
          <span aria-hidden className="flex size-[52px] flex-none items-center justify-center rounded-full border-2 border-dash-field bg-white">
            <Landmark className="size-6 text-dash-navy" strokeWidth={2.25} />
          </span>
          <h3 className="text-[15px] font-extrabold">Banka havalesi bilgileri</h3>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3.5 rounded-[20px] bg-white px-5 py-7">
          <span aria-hidden className="flex size-[88px] items-center justify-center rounded-full border-2 border-dash-field bg-white">
            <Landmark className="size-10 text-dash-navy" strokeWidth={2.25} />
          </span>
          <h2 className="text-center text-[13px] font-semibold text-dash-ink-3">Banka havalesi bilgileri</h2>
        </div>
      )}
      {payment.configured ? (
        <dl className="flex flex-col gap-[22px]">
          <WizardItem label="Hesap sahibi">
            <span className="text-[17px] font-bold">{payment.accountHolder}</span>
          </WizardItem>
          {payment.bankName ? (
            <WizardItem label="Banka">
              <span className="text-[17px] font-bold">{payment.bankName}</span>
            </WizardItem>
          ) : null}
          <WizardItem label="IBAN">
            <span className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] bg-white py-3.5 pl-[18px] pr-3.5">
              <span className="min-w-0 text-[19px] font-bold tracking-[0.04em] tabular-nums">{payment.iban}</span>
              {payment.iban ? <CopyButton value={payment.iban.replace(/\s+/g, "")} label="IBAN'ı kopyala" copiedText="IBAN kopyalandı." /> : null}
            </span>
          </WizardItem>
          {payment.instructions ? (
            <WizardItem label="Talimatlar">
              <span className="whitespace-pre-line text-sm leading-[1.6]">{payment.instructions}</span>
            </WizardItem>
          ) : null}
        </dl>
      ) : (
        <WizNote tone="warning">Ödeme için hesap bilgileri henüz tanımlanmadı. Danışmanınız ödeme bilgilerini size iletecektir.</WizNote>
      )}
    </div>
  );
}

/**
 * Bank transfer details the company enters in the admin panel (Settings → General).
 * No amount is shown: the fee is agreed between customer and consultant separately. The "write your application number
 * in the transfer description" warning was removed; if the company wants a description it
 * writes it in the "Ödeme talimatları" (payment instructions) field in Settings.
 */
export function BankTransferInfo({
  payment,
  look,
}: {
  payment: PaymentInfo;
  /** "wizard": the look in the application steps (Fee); "status": the compact look with a small heading on the status page. */
  look: "wizard" | "status";
}) {
  return <WizardBankTransferInfo payment={payment} compact={look === "status"} />;
}
