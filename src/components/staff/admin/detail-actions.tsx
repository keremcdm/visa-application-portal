"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { Check, Upload } from "lucide-react";
import { formatFileSize } from "@/components/documents/file-upload";
import { uploadApplicationFile } from "@/components/documents/upload-file";
import { useServerAction } from "@/components/ui/action-button";
import { DateInput } from "@/components/ui/date-input";
import { cn } from "@/components/ui/primitives";
import { canStaffSetVisaOutcome } from "@/features/applications/submission";
import { deletionNeedsReference, referenceConfirmed } from "@/features/staff/application-deletion";
import { ACCEPT_ATTRIBUTE, ALLOWED_FORMATS_TEXT } from "@/features/documents/file-validation";
import type { DetailAction } from "@/features/staff/admin-detail";
import { VISA_OUTCOME_NOTE_MAX, type ApplicationStatus, type PaymentStatus, type VisaOutcome } from "@/lib/domain/constants";
import { ROUTES } from "@/lib/site";
import { maskTimeTyping, parseTimeInput } from "@/lib/validation/formats";
import { deleteFileAction } from "@/server/actions/documents";
import {
  cancelApplicationAction,
  declineFormEditRequestAction,
  deleteApplicationAction,
  setFormLockAction,
  remindCustomerAction,
  requestCorrectionsAction,
  requestNewPreferencesAction,
  withdrawAppointmentAction,
  reviewPaymentAction,
  scheduleAppointmentAction,
  setApplicationStageAction,
  setVisaOutcomeAction,
} from "@/server/actions/staff";
import type { ActionResult } from "@/server/result";
import { AdminModal, ModalClose, ModalField, ResultMessage } from "./admin-modal";
import { adminButton } from "./ui";
import { useDismissSuccess } from "@/components/ui/use-dismiss-success";

/*
 * APPLICATION DETAIL — ACTIONS
 * The "Sıradaki iş" (next task) card and "Diğer işlemler" (other actions) in the right column open the same dialogs; dialogs
 * are rendered once per page. Permissions and business rules are checked again in the server actions; disabled states here
 * are only a convenience.
 */

export type CorrectionDocument = { id: string; label: string; state: string };
export type PreferenceChip = { rank: number; date: string; label: string };
export type LocationOption = { id: string; name: string; address: string };

export type DetailActionsData = {
  applicationId: string;
  status: ApplicationStatus;
  paymentStatus: PaymentStatus;
  formLocked: boolean;
  documents: CorrectionDocument[];
  /** Number of documents with files that are not marked "Uygun" (approved) (warning when confirming "Evraklar tamamlandı"). */
  uncheckedDocuments: number;
  /** Why "Evraklar tamamlandı" (documents complete) cannot be set. */
  completeBlocked: string | null;
  preferences: PreferenceChip[];
  /** Active appointment locations from Settings; null if migration 12 has not been run. */
  locations: LocationOption[] | null;
  appointment: {
    date: string;
    hour: string;
    minute: string;
    locationId: string;
    note: string;
    scheduled: boolean;
    /** Uploaded appointment letter (migration 25). */
    letter: { id: string; name: string } | null;
  };
  today: string;
  visa: { outcome: VisaOutcome; note: string; hasFile: boolean } | null;
  maxBytes: number;
  referenceCode: string;
  /** Can the application be deleted permanently (admins only; migration 27)? */
  canDelete: boolean;
};

type ModalId =
  | "verify"
  | "reject"
  | "documentsComplete"
  | "undoComplete"
  | "request"
  | "appt"
  | "withdrawAppt"
  | "result"
  | "cancel"
  | "reopen"
  | "prefs"
  | "openForm"
  | "declineFormEdit"
  | "deleteApplication";
type Feedback = { tone: "success" | "error"; text: string } | null;

const Ctx = createContext<{
  data: DetailActionsData;
  open: (id: ModalId) => void;
  feedback: Feedback;
  setFeedback: (f: Feedback) => void;
} | null>(null);

function useDetail() {
  const value = useContext(Ctx);
  if (!value) throw new Error("DetailActionsProvider eksik");
  return value;
}

export function DetailActionsProvider({ data, children }: { data: DetailActionsData; children: ReactNode }) {
  const [modal, setModal] = useState<ModalId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  useDismissSuccess(feedback, setFeedback);
  const close = () => setModal(null);
  const succeeded = (text: string) => {
    setModal(null);
    setFeedback({ tone: "success", text });
  };
  const props = { data, close, succeeded };
  return (
    <Ctx.Provider value={{ data, open: (id) => (setFeedback(null), setModal(id)), feedback, setFeedback }}>
      {children}
      {modal === "verify" ? (
        <ConfirmModal
          {...props}
          title="Ödeme doğrulansın mı?"
          description="Başvuru inceleme aşamasına geçer ve müşteriye bildirim gider. Doğrulama sonradan geri alınamaz."
          confirmLabel="Ödemeyi doğrula"
          action={() => reviewPaymentAction(data.applicationId, "verify", "")}
        />
      ) : null}
      {modal === "reject" ? <RejectPaymentModal {...props} /> : null}
      {modal === "openForm" ? (
        <ConfirmModal
          {...props}
          title="Form müşterinin düzenlemesine açılsın mı?"
          description="Müşterinin form düzenleme isteği karşılanmış olur. Müşteriye bildirim gider; müşteri düzeltmeyi bitirince “Formu düzenlemeyi tamamladım” der ve form yeniden kapanır."
          confirmLabel="Formu düzenlemeye aç"
          action={() => setFormLockAction(data.applicationId, false)}
        />
      ) : null}
      {modal === "declineFormEdit" ? <DeclineFormEditModal {...props} /> : null}
      {modal === "deleteApplication" ? <DeleteApplicationModal {...props} /> : null}
      {modal === "documentsComplete" ? (
        <ConfirmModal
          {...props}
          title="Evraklar tamamlandı olarak işaretlensin mi?"
          description={
            <>
              Başvuru randevu aşamasına geçer ve müşteriye bildirim gider.
              {data.uncheckedDocuments > 0 ? (
                <strong className="mt-2 block text-dash-navy">{data.uncheckedDocuments} belge henüz “Uygun” olarak işaretlenmedi.</strong>
              ) : null}
            </>
          }
          confirmLabel="Evraklar tamamlandı"
          action={() => setApplicationStageAction(data.applicationId, "documents_complete")}
        />
      ) : null}
      {modal === "undoComplete" ? (
        <ConfirmModal
          {...props}
          title="“Evraklar tamamlandı” işareti kaldırılsın mı?"
          description="Başvuru yeniden inceleme aşamasına döner ve müşteriye bildirim gider. Bildirilmiş randevu varsa değişmez."
          confirmLabel="İşareti kaldır"
          action={() => setApplicationStageAction(data.applicationId, "undo_documents_complete")}
        />
      ) : null}
      {modal === "reopen" ? (
        <ConfirmModal
          {...props}
          title="İptal geri alınsın mı?"
          description="Başvuru, iptal edilmeden önceki aşamasına döner ve müşteriye bildirim gider. İptal sırasında müşteriden yeni bir iş istendiyse “Müşteriden işlem bekleniyor” aşamasına geçer."
          confirmLabel="İptali geri al"
          action={() => setApplicationStageAction(data.applicationId, "reopen")}
        />
      ) : null}
      {modal === "prefs" ? (
        <ConfirmModal
          {...props}
          title="Müşteriden yeni randevu tercihi istensin mi?"
          description={
            data.appointment.scheduled
              ? "Bildirilen randevu geçersiz olur ve bilgileri silinir. Müşteriye bildirim gider; müşteri yeni tercihlerini panelinden bildirir."
              : "Müşteriye bildirim gider; müşteri yeni tercihlerini panelinden bildirir."
          }
          confirmLabel="Yeni tercih iste"
          danger={data.appointment.scheduled}
          action={() => requestNewPreferencesAction(data.applicationId)}
        />
      ) : null}
      {modal === "withdrawAppt" ? (
        <ConfirmModal
          {...props}
          title="Randevu geri çekilsin mi?"
          description="Bildirilen tarih, saat ve yer silinir; müşterinin randevu tercihleri kalır. Başvuru yeni randevu tarihini bekler ve müşteriye bildirim gider."
          confirmLabel="Randevuyu geri çek"
          danger
          action={() => withdrawAppointmentAction(data.applicationId)}
        />
      ) : null}
      {modal === "request" ? <RequestCorrectionsModal {...props} /> : null}
      {modal === "appt" ? <AppointmentModal {...props} /> : null}
      {modal === "result" ? <VisaResultModal {...props} /> : null}
      {modal === "cancel" ? <CancelModal {...props} /> : null}
    </Ctx.Provider>
  );
}

/** Actions that run without opening a dialog: the result is shown in the shared notice area and page data is refreshed. */
function useDetailRun() {
  const { setFeedback } = useDetail();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<ActionResult<unknown>>) => {
    setFeedback(null);
    startTransition(async () => {
      let result: ActionResult<unknown>;
      try {
        result = await action();
      } catch {
        result = { ok: false, message: "Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyiniz." };
      }
      setFeedback(result.ok ? (result.message ? { tone: "success", text: result.message } : null) : { tone: "error", text: result.message });
      if (result.ok) router.refresh();
    });
  };
  return { pending, run };
}

/** Result of the action ("Hatırlatma müşteriye gönderildi."). Shown above the next task card. */
export function DetailFeedback() {
  const { feedback } = useDetail();
  return <ResultMessage feedback={feedback} />;
}

// --- Buttons ---------------------------------------------------------------------------------------------------

const ACTION_LABELS: Record<DetailAction, string> = {
  remind: "Müşteriye hatırlat",
  verifyPayment: "Ödemeyi doğrula",
  rejectPayment: "Ödemeyi reddet",
  documentsComplete: "Evraklar tamamlandı",
  undoComplete: "“Evraklar tamamlandı”yı geri al",
  requestCorrections: "Ek evrak / düzeltme iste",
  scheduleAppointment: "Randevu tarihini bildir",
  reportResult: "Sonucu bildir",
  reopen: "İptali geri al",
};

const ACTION_MODAL: Partial<Record<DetailAction, ModalId>> = {
  verifyPayment: "verify",
  rejectPayment: "reject",
  documentsComplete: "documentsComplete",
  undoComplete: "undoComplete",
  requestCorrections: "request",
  scheduleAppointment: "appt",
  reportResult: "result",
  reopen: "reopen",
};

/** Primary and secondary buttons on the "Sıradaki iş" card. */
export function NextStepButton({ action, variant }: { action: DetailAction; variant: "primary" | "secondary" }) {
  const { data, open } = useDetail();
  const { pending, run } = useDetailRun();
  const className =
    variant === "primary"
      ? adminButton("primary", "lg")
      : adminButton("secondary", "lg", cn("px-[18px]", action === "rejectPayment" && "text-dash-red hover:text-dash-red"));

  if (action === "remind") {
    return (
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={() => run(() => remindCustomerAction(data.applicationId))}
      >
        {pending ? "Gönderiliyor…" : ACTION_LABELS.remind}
      </button>
    );
  }
  if (action === "documentsComplete" && data.completeBlocked) {
    return (
      <span className="flex flex-col items-start gap-1">
        <button type="button" className={className} disabled>
          {ACTION_LABELS.documentsComplete}
        </button>
        <span className="max-w-[320px] text-xs text-dash-ink-3">{data.completeBlocked}</span>
      </span>
    );
  }
  if (action === "scheduleAppointment" && (data.locations === null || data.locations.length === 0)) {
    return (
      <span className="text-sm text-dash-ink-2">
        {data.locations === null ? (
          "Randevu bildirmek için veritabanı güncellemesi (12. dosya) henüz çalıştırılmadı."
        ) : (
          <>
            Randevu bildirmek için önce{" "}
            <Link href={`${ROUTES.staffSettings}?section=locations`} className="font-bold">
              Ayarlar → Randevu yerleri
            </Link>{" "}
            bölümünden bir yer ekleyiniz.
          </>
        )}
      </span>
    );
  }
  const modal = ACTION_MODAL[action];
  return (
    <button type="button" className={className} onClick={() => modal && open(modal)}>
      {ACTION_LABELS[action]}
    </button>
  );
}

/** "Diğer işlemler" in the right column and the small buttons in sections: open the related dialog. */
export function OpenModalButton({
  modal,
  children,
  className,
  disabled,
}: {
  modal: ModalId;
  children: ReactNode;
  className: string;
  disabled?: boolean;
}) {
  const { open } = useDetail();
  return (
    <button type="button" className={className} disabled={disabled} onClick={() => open(modal)}>
      {children}
    </button>
  );
}

/** Small button that runs directly (e.g. "Tamamlandı", "Formu kapat" in the missing items list). */
export function InlineActionButton({ action, children, className }: { action: () => Promise<ActionResult<unknown>>; children: ReactNode; className: string }) {
  const { pending, run } = useDetailRun();
  return (
    <button type="button" className={className} disabled={pending} onClick={() => run(action)}>
      {pending ? "İşleniyor…" : children}
    </button>
  );
}

// --- Dialogs ------------------------------------------------------------------------------

type ModalProps = { data: DetailActionsData; close: () => void; succeeded: (text: string) => void };

const cancelButton = <ModalClose className={adminButton("secondary", "md", "h-[42px] px-[18px]")}>Vazgeç</ModalClose>;
const textareaClass =
  "w-full resize-y rounded-[16px] border-[1.5px] border-dash-line-strong bg-white px-3.5 py-3 text-sm font-normal text-dash-navy placeholder:text-dash-ink-4";
const selectClass =
  "h-[42px] w-full cursor-pointer appearance-none rounded-full border-[1.5px] border-dash-line-strong bg-white bg-[length:14px] bg-[right_14px_center] bg-no-repeat pl-3.5 pr-10 text-sm text-dash-navy [background-image:var(--admin-chevron)]";

function useModalAction(succeeded: (text: string) => void) {
  const { pending, feedback, run } = useServerAction();
  const submit = (action: () => Promise<ActionResult<unknown>>) =>
    run(async () => {
      const result = await action();
      if (result.ok) succeeded(result.message ?? "İşlem tamamlandı.");
      return result.ok ? { ok: true, message: "" } : result;
    });
  return { pending, error: feedback?.tone === "error" ? feedback : null, submit };
}

function ConfirmModal({
  close,
  succeeded,
  title,
  description,
  confirmLabel,
  danger = false,
  action,
}: ModalProps & { title: string; description: ReactNode; confirmLabel: string; danger?: boolean; action: () => Promise<ActionResult<unknown>> }) {
  const { pending, error, submit } = useModalAction(succeeded);
  return (
    <AdminModal
      open
      onOpenChange={(next) => !next && close()}
      title={title}
      description={description}
      footer={
        <>
          {cancelButton}
          <button type="button" className={adminButton(danger ? "danger" : "primary", "md", "h-[42px] px-[18px]")} disabled={pending} onClick={() => submit(action)}>
            {pending ? "İşleniyor…" : confirmLabel}
          </button>
        </>
      }
    >
      <ResultMessage feedback={error} />
    </AdminModal>
  );
}

function RejectPaymentModal({ data, close, succeeded }: ModalProps) {
  const [reason, setReason] = useState("");
  const { pending, error, submit } = useModalAction(succeeded);
  return (
    <AdminModal
      open
      onOpenChange={(next) => !next && close()}
      title="Ödemeyi reddet"
      footer={
        <>
          {cancelButton}
          <button
            type="button"
            className={adminButton("danger", "md", "h-[42px] px-[18px]")}
            disabled={pending || reason.trim() === ""}
            onClick={() => submit(() => reviewPaymentAction(data.applicationId, "reject", reason))}
          >
            {pending ? "İşleniyor…" : "Ödemeyi reddet"}
          </button>
        </>
      }
    >
      <ModalField id="reject-reason" label="Gerekçe (müşteriye gösterilir)" hint="Müşteriye bildirim gider; müşteri yeni dekont yükleyebilir.">
        <textarea
          id="reject-reason"
          className={cn(textareaClass, "min-h-[90px]")}
          placeholder="ör. Tutar eksik yatırılmış"
          maxLength={1000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-describedby="reject-reason-hint"
        />
      </ModalField>
      <ResultMessage feedback={error} />
    </AdminModal>
  );
}

/** Checkbox row (a selection row with 14px corners in the design). */
function CheckRow({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-[14px] border-[1.5px] px-3.5 py-2.5 text-left text-sm text-dash-navy has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-dash-red",
        checked ? "border-dash-navy bg-dash-subtle" : "border-dash-line bg-white",
        disabled && "cursor-default opacity-60",
      )}
    >
      <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden
        className={cn("grid size-[18px] flex-none place-items-center rounded-[6px] border-[1.5px]", checked ? "border-dash-navy bg-dash-navy" : "border-dash-dot bg-white")}
      >
        {checked ? <Check className="size-[11px] text-white" strokeWidth={4} /> : null}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}

function RequestCorrectionsModal({ data, close, succeeded }: ModalProps) {
  const [selected, setSelected] = useState<string[]>([]);
  // Optional separate note for each document.
  const [documentNotes, setDocumentNotes] = useState<Record<string, string>>({});
  const [openForm, setOpenForm] = useState(false);
  const [note, setNote] = useState("");
  const { pending, error, submit } = useModalAction(succeeded);
  const formAlreadyOpen = !data.formLocked;
  const nothing = selected.length === 0 && !openForm;
  return (
    <AdminModal
      open
      onOpenChange={(next) => !next && close()}
      title="Ek evrak / düzeltme iste"
      footer={
        <>
          {cancelButton}
          <button
            type="button"
            className={adminButton("primary", "md", "h-[42px] px-[18px]")}
            disabled={pending || nothing}
            onClick={() => submit(() => requestCorrectionsAction(data.applicationId, { documentIds: selected, documentNotes, openForm, note }))}
          >
            {pending ? "Gönderiliyor…" : "Müşteriden iste"}
          </button>
        </>
      }
    >
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-[13px] font-bold">Yeniden istenecek belgeler</legend>
        {data.documents.length === 0 ? <p className="text-sm text-dash-ink-2">Bu başvuruda belge listesi yok.</p> : null}
        <div className="flex max-h-[260px] flex-col gap-1.5 overflow-y-auto pr-1">
          {data.documents.map((doc) => {
            const checked = selected.includes(doc.id);
            const noteId = `request-note-${doc.id}`;
            return (
              <div key={doc.id} className="flex flex-col gap-1.5">
                <CheckRow checked={checked} onChange={(on) => setSelected((list) => (on ? [...list, doc.id] : list.filter((id) => id !== doc.id)))}>
                  <span className="block">{doc.label}</span>
                  <span className="block text-xs text-dash-ink-3">{doc.state}</span>
                </CheckRow>
                {checked ? (
                  <div className="pl-8">
                    <label htmlFor={noteId} className="sr-only">
                      {doc.label} için müşteriye not
                    </label>
                    <textarea
                      id={noteId}
                      className={cn(textareaClass, "min-h-[52px]")}
                      placeholder={`${doc.label} için not (isteğe bağlı)`}
                      maxLength={1000}
                      value={documentNotes[doc.id] ?? ""}
                      onChange={(e) => setDocumentNotes((notes) => ({ ...notes, [doc.id]: e.target.value }))}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </fieldset>
      <CheckRow checked={openForm || formAlreadyOpen} disabled={formAlreadyOpen} onChange={setOpenForm}>
        Başvuru formunu müşterinin düzenlemesine aç
        {formAlreadyOpen ? <span className="block text-xs text-dash-ink-3">Form zaten müşterinin düzenlemesine açık.</span> : null}
      </CheckRow>
      <label htmlFor="request-note" className="sr-only">
        Müşteriye not
      </label>
      <textarea
        id="request-note"
        className={cn(textareaClass, "min-h-[70px]")}
        placeholder="Genel not (isteğe bağlı; notu yazılmamış belgelerde ve form düzeltmesinde gösterilir)"
        maxLength={1000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <p className="text-xs text-dash-ink-3">
        Müşteriye bildirim gider; başvuru “Müşteriden işlem bekleniyor” aşamasına geçer. Listede olmayan bir belge için Evraklar sekmesindeki “Müşteriden
        yeni belge iste” bölümünü kullanınız.
      </p>
      <ResultMessage feedback={error} />
    </AdminModal>
  );
}

function AppointmentModal({ data, close, succeeded }: ModalProps) {
  const current = data.appointment;
  const locations = data.locations ?? [];
  const [date, setDate] = useState(current.date);
  // The time is typed in.
  const [time, setTime] = useState(current.hour && current.minute ? `${current.hour}:${current.minute}` : "");
  const parsedTime = parseTimeInput(time);
  const timeError = time.length >= 4 && !parsedTime ? "Saati SS:DD biçiminde yazınız (ör. 09:30)." : undefined;
  const [locationId, setLocationId] = useState(locations.some((l) => l.id === current.locationId) ? current.locationId : (locations[0]?.id ?? ""));
  const [note, setNote] = useState(current.note);
  // The appointment letter is optional; uploading a new one deletes the old one.
  const [letter, setLetter] = useState<File | null>(null);
  const [keepLetter, setKeepLetter] = useState(true);
  const letterId = useId();
  const { pending, error, submit } = useModalAction(succeeded);
  const selected = locations.find((l) => l.id === locationId) ?? null;
  const ready = Boolean(date && parsedTime && locationId);

  const send = () =>
    submit(async () => {
      if (letter) {
        const upload = await uploadApplicationFile(data.applicationId, { kind: "appointment_letter" }, letter, data.maxBytes);
        if (!upload.ok) return { ok: false, message: `Randevu belgesi yüklenemedi: ${upload.message} Randevu bildirilmedi.` };
      } else if (current.letter && !keepLetter) {
        const removed = await deleteFileAction(data.applicationId, current.letter.id);
        if (!removed.ok) return { ok: false, message: `Randevu belgesi silinemedi: ${removed.message} Randevu bildirilmedi.` };
      }
      return scheduleAppointmentAction(data.applicationId, { localDateTime: `${date}T${parsedTime}`, locationId, note, letterUploaded: letter !== null });
    });

  return (
    <AdminModal
      open
      onOpenChange={(next) => !next && close()}
      title="Randevu tarihini bildir"
      footer={
        <>
          {cancelButton}
          <button
            type="button"
            className={adminButton("primary", "md", "h-[42px] px-[18px]")}
            disabled={pending || !ready}
            onClick={send}
          >
            {pending ? "Gönderiliyor…" : "Randevuyu bildir"}
          </button>
        </>
      }
    >
      {data.preferences.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-bold">Müşterinin tercihleri</span>
          <div className="flex flex-wrap gap-1.5">
            {data.preferences.map((p) => (
              <button
                key={p.rank}
                type="button"
                aria-pressed={date === p.date}
                onClick={() => setDate(p.date)}
                className={cn(
                  "h-[34px] rounded-full border-[1.5px] px-3 text-[13px] font-semibold text-dash-navy",
                  date === p.date ? "border-dash-navy bg-dash-subtle" : "border-dash-line-strong bg-white hover:bg-dash-subtle",
                )}
              >
                {p.rank}. {p.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_170px]">
        <ModalField id="appt-date" label="Tarih">
          <DateInput id="appt-date" value={date} min={data.today} onChange={setDate} />
        </ModalField>
        <ModalField id="appt-time" label="Saat (TSİ)" error={timeError}>
          <input
            id="appt-time"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="SS:DD"
            maxLength={5}
            value={time}
            onChange={(e) => setTime(maskTimeTyping(e.target.value))}
            aria-invalid={timeError ? true : undefined}
            aria-describedby={timeError ? "appt-time-error" : undefined}
            className={selectClass}
          />
        </ModalField>
      </div>
      <ModalField id="appt-place" label="Yer" hint={selected ? <span className="whitespace-pre-line">{selected.address}</span> : undefined}>
        <select id="appt-place" value={locationId} onChange={(e) => setLocationId(e.target.value)} className={selectClass} aria-describedby="appt-place-hint">
          <option value="">Seçiniz</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </ModalField>
      <label htmlFor="appt-note" className="sr-only">
        Not
      </label>
      <textarea
        id="appt-note"
        className={cn(textareaClass, "min-h-[60px]")}
        placeholder="Not (isteğe bağlı) — ör. pasaportunuzun aslını getiriniz"
        maxLength={1000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <label
        htmlFor={letterId}
        className="flex cursor-pointer items-center gap-2.5 rounded-[16px] border-[1.5px] border-dashed border-dash-dot px-3.5 py-3 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-dash-red"
      >
        <Upload aria-hidden className="size-[18px] flex-none text-dash-ink-2" strokeWidth={2.5} />
        <span className="mr-auto min-w-0 truncate">{letter ? letter.name : "Randevu belgesi / appointment letter (isteğe bağlı)"}</span>
        <span className="font-bold">Dosya seç</span>
        <input
          id={letterId}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          className="sr-only"
          onChange={(e) => setLetter(e.target.files?.[0] ?? null)}
          aria-describedby={`${letterId}-hint`}
        />
      </label>
      <span id={`${letterId}-hint`} className="-mt-2 text-xs text-dash-ink-3">
        {ALLOWED_FORMATS_TEXT}, en fazla {formatFileSize(data.maxBytes)}. Müşteri randevu bilgisinin yanında görüntüleyip indirebilir.
        {current.letter ? " Yeni dosya seçerseniz mevcut belgenin yerine geçer." : ""}
      </span>
      {current.letter && !letter ? (
        <CheckRow checked={keepLetter} onChange={setKeepLetter}>
          Mevcut randevu belgesi kalsın
          <span className="block truncate text-xs text-dash-ink-3">{current.letter.name}</span>
        </CheckRow>
      ) : null}
      <p className="text-xs text-dash-ink-3">Müşteriye bildirim gider. Randevu saati geçince başvuru kendiliğinden “Sonuç bekleniyor”a geçer.</p>
      <ResultMessage feedback={error} />
    </AdminModal>
  );
}

function VisaResultModal({ data, close, succeeded }: ModalProps) {
  const id = useId();
  const editing = data.visa !== null;
  const [step, setStep] = useState<1 | 2>(1);
  const [result, setResult] = useState<VisaOutcome | null>(data.visa?.outcome ?? null);
  const [message, setMessage] = useState(data.visa?.note ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [keepFile, setKeepFile] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const { pending, error, submit } = useModalAction(succeeded);
  const refused = result === "refused";
  const rule = result ? canStaffSetVisaOutcome(data.status, data.paymentStatus, result, message) : null;
  const choice = (value: VisaOutcome) =>
    cn(
      "h-11 flex-1 rounded-full border-[1.5px] text-sm font-bold",
      result === value
        ? value === "refused"
          ? "border-dash-red bg-dash-red-tint text-dash-red"
          : "border-dash-green bg-dash-green-tint text-dash-green-ink"
        : "border-dash-line-strong bg-white text-dash-navy hover:bg-dash-subtle",
    );

  const send = () =>
    submit(async () => {
      if (!result) return { ok: false, message: "Sonucu seçiniz: onaylandı veya reddedildi." };
      let fileId: string | null = null;
      if (file) {
        const upload = await uploadApplicationFile(data.applicationId, { kind: "visa_result" }, file, data.maxBytes);
        if (!upload.ok) return { ok: false, message: `Dosya yüklenemedi: ${upload.message} Sonuç bildirilmedi.` };
        fileId = upload.fileId;
      }
      return setVisaOutcomeAction(data.applicationId, { outcome: result, note: message, fileId, keepCurrentFile: keepFile });
    });

  if (step === 2 && result) {
    const word = result === "approved" ? "Onaylandı" : "Reddedildi";
    return (
      <AdminModal
        open
        onOpenChange={(next) => !next && close()}
        title={editing ? "Sonuç güncellensin mi?" : "Sonuç bildirilsin mi?"}
        description={
          editing ? (
            <>
              Müşteriye bildirilen sonuç <strong className="text-dash-navy">{word}</strong> olarak güncellenecek; müşteriye bildirim gider.
            </>
          ) : (
            <>
              Müşteriye <strong className="text-dash-navy">{word}</strong> sonucu, mesajınız{file ? " ve ekli dosya" : ""} gönderilecek. Başvuru kapanır; bu
              işlem geri alınamaz.
            </>
          )
        }
        footer={
          <>
            <button type="button" className={adminButton("secondary", "md", "h-[42px] px-[18px]")} disabled={pending} onClick={() => setStep(1)}>
              Geri
            </button>
            <button type="button" className={adminButton("danger", "md", "h-[42px] px-[18px]")} disabled={pending} onClick={send}>
              {pending ? "Gönderiliyor…" : editing ? "Sonucu güncelle" : "Sonucu bildir"}
            </button>
          </>
        }
      >
        <ResultMessage feedback={error} />
      </AdminModal>
    );
  }

  return (
    <AdminModal
      open
      onOpenChange={(next) => !next && close()}
      title={editing ? "Vize sonucunu düzelt" : "Vize sonucunu bildir"}
      footer={
        <>
          {cancelButton}
          <button type="button" className={adminButton("primary", "md", "h-[42px] px-[18px]")} disabled={!rule?.ok} onClick={() => setStep(2)}>
            Devam
          </button>
        </>
      }
    >
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-[13px] font-bold">Sonuç (zorunlu)</legend>
        <div className="flex gap-2">
          <button type="button" aria-pressed={result === "approved"} className={choice("approved")} onClick={() => setResult("approved")}>
            Onaylandı
          </button>
          <button type="button" aria-pressed={result === "refused"} className={choice("refused")} onClick={() => setResult("refused")}>
            Reddedildi
          </button>
        </div>
      </fieldset>
      <ModalField id={`${id}-msg`} label={refused ? "Müşteriye mesaj (ret gerekçesi zorunlu)" : "Müşteriye mesaj"}>
        <textarea
          id={`${id}-msg`}
          className={cn(textareaClass, "min-h-[80px]")}
          placeholder="Onay: pasaport teslim bilgisi · Ret: gerekçe"
          maxLength={VISA_OUTCOME_NOTE_MAX}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </ModalField>
      <label
        htmlFor={`${id}-file`}
        className="flex cursor-pointer items-center gap-2.5 rounded-[16px] border-[1.5px] border-dashed border-dash-dot px-3.5 py-3 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-dash-red"
      >
        <Upload aria-hidden className="size-[18px] flex-none text-dash-ink-2" strokeWidth={2.5} />
        <span className="mr-auto min-w-0 truncate">{file ? file.name : "Sonuç ekran görüntüsü / belgesi (isteğe bağlı)"}</span>
        <span className="font-bold">Dosya seç</span>
        <input
          ref={fileInput}
          id={`${id}-file`}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          className="sr-only"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          aria-describedby={`${id}-file-hint`}
        />
      </label>
      <span id={`${id}-file-hint`} className="-mt-2 text-xs text-dash-ink-3">
        {ALLOWED_FORMATS_TEXT}, en fazla {formatFileSize(data.maxBytes)}. Müşteri sonucu açtığında görür.
      </span>
      {data.visa?.hasFile && !file ? (
        <CheckRow checked={keepFile} onChange={setKeepFile}>
          Mevcut dosya kalsın
        </CheckRow>
      ) : null}
      {result && rule && !rule.ok ? <p className="text-xs text-dash-ink-3">{rule.message}</p> : null}
    </AdminModal>
  );
}

/** Refusing the customer's form edit request. */
function DeclineFormEditModal({ data, close, succeeded }: ModalProps) {
  const [reason, setReason] = useState("");
  const { pending, error, submit } = useModalAction(succeeded);
  return (
    <AdminModal
      open
      onOpenChange={(next) => !next && close()}
      title="Form düzenleme isteğini reddet"
      description="Form kilitli kalır ve müşteriye bildirim gider. Gerekçe yazarsanız bildirimde görünür."
      footer={
        <>
          {cancelButton}
          <button
            type="button"
            className={adminButton("danger", "md", "h-[42px] px-[18px]")}
            disabled={pending}
            onClick={() => submit(() => declineFormEditRequestAction(data.applicationId, reason))}
          >
            {pending ? "İşleniyor…" : "Reddet"}
          </button>
        </>
      }
    >
      <ModalField id="decline-form-edit-reason" label="Müşteriye gerekçe (isteğe bağlı)" hint="Örnek: Bu bilgi randevu sırasında düzeltilecek; formu değiştirmenize gerek yok.">
        <textarea
          id="decline-form-edit-reason"
          className={cn(textareaClass, "min-h-[80px]")}
          maxLength={1000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-describedby="decline-form-edit-reason-hint"
        />
      </ModalField>
      <ResultMessage feedback={error} />
    </AdminModal>
  );
}

/**
 * Deleting the application permanently. For a submitted application
 * the button does nothing until the application number is typed. After deletion we return to the Applications list.
 */
function DeleteApplicationModal({ data, close }: ModalProps) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const needsReference = deletionNeedsReference(data.status);
  const ready = !needsReference || referenceConfirmed(data.referenceCode, typed);
  const remove = () =>
    startTransition(async () => {
      setError(null);
      let result: ActionResult;
      try {
        result = await deleteApplicationAction(data.applicationId, typed);
      } catch {
        result = { ok: false, message: "Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyiniz." };
      }
      if (result.ok) router.replace(`${ROUTES.staff}?deleted=1`);
      else setError(result.message);
    });

  return (
    <AdminModal
      open
      onOpenChange={(next) => !next && !pending && close()}
      title="Başvuru kalıcı olarak silinsin mi?"
      description={
        <>
          <strong className="text-dash-navy">{data.referenceCode}</strong> numaralı başvuru; form cevapları, yüklenen bütün belgeler, mesajlar, iç notlar ve
          görevlerle birlikte kalıcı olarak silinir. <strong className="text-dash-navy">Bu işlem geri alınamaz.</strong> Müşterinin hesabı silinmez;
          işlem geçmişine yalnızca başvuru numarası ve silen kişi yazılır.
        </>
      }
      footer={
        <>
          {cancelButton}
          <button type="button" className={adminButton("danger", "md", "h-[42px] px-[18px]")} disabled={pending || !ready} onClick={remove}>
            {pending ? "Siliniyor…" : "Başvuruyu kalıcı olarak sil"}
          </button>
        </>
      }
    >
      {needsReference ? (
        <ModalField
          id="delete-reference"
          label={`Onaylamak için başvuru numarasını yazınız: ${data.referenceCode}`}
          hint="Bu başvuru gönderilmiş olduğu için numara yazılmadan silinemez."
        >
          <input
            id="delete-reference"
            type="text"
            autoComplete="off"
            spellCheck={false}
            maxLength={40}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-describedby="delete-reference-hint"
            className={selectClass}
          />
        </ModalField>
      ) : null}
      <ResultMessage feedback={error ? { tone: "error", text: error } : null} />
    </AdminModal>
  );
}

function CancelModal({ data, close, succeeded }: ModalProps) {
  const [reason, setReason] = useState("");
  const { pending, error, submit } = useModalAction(succeeded);
  return (
    <AdminModal
      open
      onOpenChange={(next) => !next && close()}
      title="Başvuruyu iptal et"
      description="Başvuru kapanır; müşteri yalnızca mesajları görebilir. İptali sonradan “İptali geri al” ile geri alabilirsiniz."
      footer={
        <>
          {cancelButton}
          <button
            type="button"
            className={adminButton("danger", "md", "h-[42px] px-[18px]")}
            disabled={pending || reason.trim() === ""}
            onClick={() => submit(() => cancelApplicationAction(data.applicationId, reason))}
          >
            {pending ? "İşleniyor…" : "İptal et"}
          </button>
        </>
      }
    >
      <ModalField id="cancel-reason" label="Gerekçe (zorunlu)" hint="Yalnızca personel görür; İç notlara kaydedilir. Müşteriye “İptal edildi” bildirimi gider.">
        <textarea
          id="cancel-reason"
          className={cn(textareaClass, "min-h-[80px]")}
          maxLength={1000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-describedby="cancel-reason-hint"
        />
      </ModalField>
      <ResultMessage feedback={error} />
    </AdminModal>
  );
}
