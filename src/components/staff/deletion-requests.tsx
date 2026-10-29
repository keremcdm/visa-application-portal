"use client";

import { useState } from "react";
import { ActionButton, ActionFeedback, useServerAction } from "@/components/ui/action-button";
import { Field, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/primitives";
import { approveAccountDeletionAction, rejectAccountDeletionAction } from "@/server/actions/account";

export type DeletionRequestItem = {
  id: string;
  createdAtText: string;
  customerName: string;
  customerEmail: string;
  submittedCount: number;
  draftCount: number;
};

/** Admin → a pending account deletion request: delete the account or refuse with a reason (both apply immediately). */
export function DeletionRequestRow({ item }: { item: DeletionRequestItem }) {
  const [note, setNote] = useState("");
  const reject = useServerAction();
  const noteId = `deletion-note-${item.id}`;
  return (
    <li className="rounded-md border border-line bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-ink">
            {item.customerName} · <span className="text-muted">{item.customerEmail}</span>
          </p>
          <p className="mt-0.5 text-sm text-muted">
            Talep: {item.createdAtText} · {item.submittedCount} gönderilmiş, {item.draftCount} taslak başvuru
          </p>
        </div>
        <ActionButton
          variant="danger"
          size="sm"
          pendingLabel="Siliniyor…"
          action={approveAccountDeletionAction.bind(null, item.id)}
          confirm={{
            title: "Müşterinin hesabı silinsin mi?",
            description: `${item.customerName} adlı müşterinin hesabı, gönderilmiş olanlar dahil tüm başvuruları (${item.submittedCount + item.draftCount}) ve yüklenen bütün belgeler kalıcı olarak silinecek. Bu işlem geri alınamaz.`,
            confirmLabel: "Hesabı kalıcı olarak sil",
            tone: "danger",
          }}
        >
          Hesabı sil
        </ActionButton>
      </div>
      <div className="mt-3 border-t border-line pt-3">
        <Field id={noteId} label="Reddetme gerekçesi" hint="Müşteri bu açıklamayı görür ve bildirim alır.">
          <Textarea id={noteId} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} aria-describedby={`${noteId}-hint`} />
        </Field>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button size="sm" variant="secondary" disabled={reject.pending} onClick={() => reject.run(() => rejectAccountDeletionAction(item.id, note), () => setNote(""))}>
            {reject.pending ? "Kaydediliyor…" : "Talebi reddet"}
          </Button>
          <ActionFeedback feedback={reject.feedback} />
        </div>
      </div>
    </li>
  );
}
