"use client";

import { useState } from "react";
import { uploadApplicationFile } from "@/components/documents/upload-file";
import { ACCEPT_ATTRIBUTE, ALLOWED_FORMATS_TEXT } from "@/features/documents/file-validation";
import type { ActionResult } from "@/server/result";
import { ActionFeedback, useServerAction } from "@/components/ui/action-button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/primitives";
import { formatFileSize } from "@/lib/validation/formats";
import { addStaffNoteAction, requestDocumentAction, sendMessageAction } from "@/server/actions/staff";

// --- Message, internal note, document request ----------------------------------------

function TextComposer({
  id,
  label,
  hint,
  submitLabel,
  action,
}: {
  id: string;
  label: string;
  hint: string;
  submitLabel: string;
  action: (text: string) => Promise<ActionResult<unknown>>;
}) {
  const [text, setText] = useState("");
  const { pending, feedback, run } = useServerAction();
  return (
    <div>
      <Field id={id} label={label} hint={hint}>
        <Textarea id={id} value={text} maxLength={4000} rows={3} onChange={(e) => setText(e.target.value)} aria-describedby={`${id}-hint`} />
      </Field>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={pending || text.trim() === ""} onClick={() => run(() => action(text), () => setText(""))}>
          {pending ? "Gönderiliyor…" : submitLabel}
        </Button>
        <ActionFeedback feedback={feedback} />
      </div>
    </div>
  );
}

export function MessageComposer({ applicationId }: { applicationId: string }) {
  return (
    <TextComposer
      id="new-message"
      label="Müşteriye mesaj"
      hint="Bu mesajı müşteri kendi panelinde görür."
      submitLabel="Mesajı gönder"
      action={(text) => sendMessageAction(applicationId, text)}
    />
  );
}

export function NoteComposer({ applicationId }: { applicationId: string }) {
  return (
    <TextComposer
      id="new-note"
      label="İç not"
      hint="Yalnızca personel görür. Müşteriye hiçbir şekilde gösterilmez."
      submitLabel="Notu kaydet"
      action={(text) => addStaffNoteAction(applicationId, text)}
    />
  );
}

/**
 * Request for a new document from the customer. Optionally a document the customer downloads and fills in/signs (e.g. a
 * form template) is attached when the request is created. The document can later be viewed, replaced or deleted from the card.
 */
export function DocumentRequestForm({ applicationId, maxBytes }: { applicationId: string; maxBytes: number }) {
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [requirement, setRequirement] = useState("required");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const { pending, feedback, run } = useServerAction();

  const clearAttachment = () => {
    setAttachment(null);
    setInputKey((k) => k + 1);
  };
  // Before sending, the selected file opens in a new tab (not uploaded yet; the local copy is shown).
  const previewAttachment = () => {
    if (!attachment) return;
    const url = URL.createObjectURL(attachment);
    window.open(url, "_blank", "noopener");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const create = async (): Promise<ActionResult<unknown>> => {
    const created = await requestDocumentAction(applicationId, { label, description, requirement, withAttachment: Boolean(attachment) });
    if (!created.ok || !attachment || !created.data) return created;
    const upload = await uploadApplicationFile(applicationId, { kind: "staff_attachment", documentId: created.data.documentId }, attachment, maxBytes);
    return upload.ok
      ? { ok: true, message: "Belge isteği oluşturuldu; müşteriye gönderilen belge eklendi." }
      : { ok: false, message: `Belge isteği oluşturuldu ancak müşteriye gönderilecek dosya yüklenemedi: ${upload.message} Dosyayı listedeki istekten yeniden ekleyebilirsiniz.` };
  };
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field id="request-label" label="İstenen belgenin adı" required>
        <Input id="request-label" value={label} maxLength={160} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <Field id="request-requirement" label="Zorunluluk">
        <Select id="request-requirement" value={requirement} onChange={(e) => setRequirement(e.target.value)}>
          <option value="optional">İsteğe bağlı</option>
          <option value="required">Zorunlu</option>
        </Select>
      </Field>
      <Field id="request-description" label="Müşteriye açıklama" hint="Ne istendiğini ve nasıl hazırlanacağını yazınız." className="sm:col-span-2">
        <Textarea id="request-description" value={description} maxLength={600} rows={2} onChange={(e) => setDescription(e.target.value)} aria-describedby="request-description-hint" />
      </Field>
      <Field
        id="request-attachment"
        label="Müşteriye indirmesi için belge (isteğe bağlı)"
        hint={`Müşterinin indirip dolduracağı veya imzalayacağı bir belge. ${ALLOWED_FORMATS_TEXT}; en fazla ${Math.round(maxBytes / (1024 * 1024))} MB.`}
        className="sm:col-span-2"
      >
        <input
          key={inputKey}
          id="request-attachment"
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          onChange={(e) => setAttachment(e.target.files?.[0] ?? null)}
          aria-describedby="request-attachment-hint"
          className="block w-full text-sm text-ink file:mr-3 file:rounded-full file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-semibold"
        />
        {attachment ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="mr-auto min-w-0 break-all font-medium text-ink">
              Seçilen dosya: {attachment.name} ({formatFileSize(attachment.size)})
            </span>
            <Button size="sm" variant="secondary" onClick={previewAttachment}>
              Görüntüle
            </Button>
            <Button size="sm" variant="ghost" onClick={clearAttachment}>
              Kaldır
            </Button>
          </div>
        ) : null}
      </Field>
      <div className="sm:col-span-2">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            disabled={pending || label.trim() === ""}
            onClick={() =>
              run(create, () => {
                setLabel("");
                setDescription("");
                clearAttachment();
              })
            }
          >
            {pending ? "Oluşturuluyor…" : "Belge iste"}
          </Button>
          <ActionFeedback feedback={feedback} />
        </div>
      </div>
    </div>
  );
}
