"use client";

import { ActionButton } from "@/components/ui/action-button";
import { deleteDraftAction } from "@/server/actions/applications";

/** "Taslağı sil" (delete draft) on a draft card: asked with a confirmation dialog, permanent. */
export function DeleteDraftButton({ applicationId, referenceCode }: { applicationId: string; referenceCode: string }) {
  return (
    <ActionButton
      action={() => deleteDraftAction(applicationId)}
      pendingLabel="Siliniyor…"
      buttonClassName="flex h-11 flex-none items-center rounded-full border-[1.5px] border-dash-field bg-white px-[18px] text-[15px] font-bold text-dash-red transition-colors hover:border-dash-red-border hover:bg-dash-red-tint disabled:cursor-not-allowed disabled:opacity-50"
      feedbackClassName="max-w-56"
      confirm={{
        title: "Taslak silinsin mi?",
        description: `${referenceCode} numaralı taslak başvurunuz, girdiğiniz form bilgileri ve yüklediğiniz belgelerle birlikte kalıcı olarak silinecek. Bu işlem geri alınamaz.`,
        confirmLabel: "Taslağı sil",
        tone: "delete",
      }}
    >
      Taslağı sil
    </ActionButton>
  );
}
