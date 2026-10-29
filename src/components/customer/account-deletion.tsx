"use client";

import { TriangleAlert } from "lucide-react";
import { wizButtonClass, WizNote } from "@/components/customer/wizard/ui";
import { ActionButton } from "@/components/ui/action-button";
import { formatDateTimeTr } from "@/lib/validation/formats";
import { deleteMyAccountAction, requestAccountDeletionAction } from "@/server/actions/account";

/** The filled red button from the design: warning icon on the left, light red shadow. */
const DANGER_BUTTON = wizButtonClass("danger", "lg", "shadow-[0_6px_16px_color-mix(in_srgb,var(--color-dash-red)_22%,transparent)]");

/**
 * My Account → "Hesabı sil" (delete account).
 * Without a submitted application the account is deleted immediately; otherwise a deletion request is sent to the company.
 */
export function AccountDeletion({
  available,
  hasSubmitted,
  pendingSince,
  lastRejection,
}: {
  available: boolean;
  hasSubmitted: boolean;
  pendingSince: string | null;
  lastRejection: { at: string; note: string } | null;
}) {
  if (!available) {
    return <p className="text-sm text-dash-ink-2">Hesap silme şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyiniz.</p>;
  }

  if (!hasSubmitted) {
    return (
      <div className="flex flex-col gap-5">
        <p className="text-sm leading-[1.6] [text-wrap:pretty]">
          Hesabınızı silerseniz hesabınız, taslak başvurularınız ve yüklediğiniz belgeler <strong className="font-extrabold">kalıcı olarak</strong> silinir.
          Bu işlem geri alınamaz.
        </p>
        <ActionButton
          buttonClassName={DANGER_BUTTON}
          // Keep the button in the confirmation dialog red as well.
          variant="danger"
          action={deleteMyAccountAction}
          pendingLabel="Siliniyor…"
          confirm={{
            title: "Hesabınız silinsin mi?",
            description:
              "Hesabınız, taslak başvurularınız ve yüklediğiniz belgeler kalıcı olarak silinecek. Bu işlem geri alınamaz.",
            confirmLabel: "Hesabımı kalıcı olarak sil",
            tone: "danger",
          }}
        >
          <TriangleAlert aria-hidden className="size-[17px]" strokeWidth={2.75} />
          Hesabımı sil
        </ActionButton>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm leading-[1.6] [text-wrap:pretty]">
        Gönderilmiş başvurunuz olduğu için hesabınız doğrudan silinemez. Silme talebi gönderdiğinizde şirketimiz talebinizi inceler ve sizi
        bilgilendirir.
      </p>
      {lastRejection ? (
        <WizNote tone="warning" title={`Önceki silme talebiniz ${formatDateTimeTr(lastRejection.at)} tarihinde reddedildi`}>
          <p className="whitespace-pre-line">{lastRejection.note}</p>
        </WizNote>
      ) : null}
      {pendingSince ? (
        <WizNote tone="info" title="Silme talebiniz alındı" role="status">
          Talebiniz {formatDateTimeTr(pendingSince)} tarihinde alındı; şirketimiz inceliyor. Sonuç size bildirilecek.
        </WizNote>
      ) : (
        <ActionButton
          buttonClassName={DANGER_BUTTON}
          // Keep the button in the confirmation dialog red as well.
          variant="danger"
          action={requestAccountDeletionAction}
          pendingLabel="Gönderiliyor…"
          confirm={{
            title: "Hesap silme talebi gönderilsin mi?",
            description:
              "Talebiniz şirketimize iletilir. Şirketimiz hesabınızı ve başvurularınızı silebilir veya gerekçesini belirterek talebi reddedebilir. Sonuç size bildirilir.",
            confirmLabel: "Talebi gönder",
            tone: "danger",
          }}
        >
          <TriangleAlert aria-hidden className="size-[17px]" strokeWidth={2.75} />
          Hesap silme talebi gönder
        </ActionButton>
      )}
    </div>
  );
}
