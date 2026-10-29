import Link from "next/link";
import type { ReactNode } from "react";
import { Bell, Check, FileText, Info, Paperclip, X } from "lucide-react";
import { FileRow } from "@/components/documents/file-upload";
import { FormAnswers } from "@/components/shared/form-answers";
import { DocumentRequestForm, MessageComposer, NoteComposer } from "@/components/staff/application-controls";
import { DetailActionsProvider, DetailFeedback, InlineActionButton, NextStepButton, OpenModalButton, type DetailActionsData } from "@/components/staff/admin/detail-actions";
import { DetailSection, RiskAnswersButton, TaskPanel } from "@/components/staff/admin/detail-sections";
import { AdminCard, AdminEyebrow, AdminNote, AdminPill, adminButton } from "@/components/staff/admin/ui";
import { DocumentReviewCard } from "@/components/staff/document-review";
import { ExportButton } from "@/components/staff/export-button";
import { cn } from "@/components/ui/primitives";
import { pruneFormData, validateForm } from "@/features/application-form/engine";
import { unseenExtraDocumentIds, viewedFileIdsFrom } from "@/features/documents/extra-documents";
import { extraDocumentsFrom } from "@/features/applications/progress";
import { canCancelApplication, canManageAppointment, canMarkDocumentsComplete, outstandingCustomerActions } from "@/features/applications/status-flow";
import { appointmentParts } from "@/features/appointments/calendar";
import type { RiskBandKey } from "@/features/risk-test/definition";
import { riskTestStaffSummary } from "@/features/risk-test/summary";
import {
  auditActorTexts,
  CANCEL_REASON_PREFIX,
  detailStages,
  nextStep,
  shortDate,
  shortDateTimeText,
  staffActorText,
  type DetailStage,
} from "@/features/staff/admin-detail";
import { ADMIN_STATES, adminStateKey, OWNER_LABELS, SECTION_MODES, stageOfStatus, type AdminTone, type SectionMode } from "@/features/staff/admin-state";
import {
  APPLICATION_TYPE_LABELS,
  APPOINTMENT_SLOT_LABELS,
  applicationStatusLabel,
  appointmentStatusLabel,
  DOCUMENT_REVIEW_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  SPONSOR_STATUS_LABELS,
} from "@/lib/domain/constants";
import { documentAnchor, ROUTES, staffApplicationPath } from "@/lib/site";
import { formatDateTimeTr, formatDateTr, formatFileSize, todayInIstanbul } from "@/lib/validation/formats";
import { isEmailConfigured } from "@/server/email/mailer";
import type { AuditEntry, StaffApplicationDetail } from "@/server/data/staff";
import type { ApplicationFile } from "@/server/data/types";
import { setFormLockAction, setTaskStatusAction } from "@/server/actions/staff";
import { maxUploadBytes } from "@/server/limits";

/*
 * ADMIN — APPLICATION DETAIL
 * Header, tabs and the "Genel" (general) tab follow the design; the other tabs use the same language. States, texts and the
 * stage line are in src/features/staff/admin-detail.ts; actions are checked again on the server.
 */

const TABS = [
  { id: "general", label: "Genel" },
  { id: "form", label: "Form cevapları" },
  { id: "documents", label: "Evraklar" },
  { id: "messages", label: "Mesajlar ve notlar" },
  { id: "history", label: "İşlem geçmişi" },
] as const;
export type TabId = (typeof TABS)[number]["id"];

const fileItem = (file: ApplicationFile) => ({
  id: file.id,
  originalName: file.originalName,
  sizeBytes: file.sizeBytes,
  createdAtText: formatDateTimeTr(file.createdAt),
});

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** Splits an ISO timestamp into "YYYY-MM-DD", "HH", "mm" parts in Istanbul time (Türkiye is UTC+3 all year). */
function istanbulParts(iso: string | null): { date: string; hour: string; minute: string } {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return { date: "", hour: "", minute: "" };
  const local = new Date(date.getTime() + 3 * 60 * 60 * 1000).toISOString();
  return { date: local.slice(0, 10), hour: local.slice(11, 13), minute: local.slice(14, 16) };
}

const DAY_MONTH_SHORT = new Intl.DateTimeFormat("tr-TR", { timeZone: "UTC", day: "numeric", month: "short" });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat("tr-TR", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });
const WEEKDAY = new Intl.DateTimeFormat("tr-TR", { timeZone: "UTC", weekday: "long" });
const utcDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
};

const AUDIT_LABELS: Record<string, string> = {
  "application.submitted": "Başvuru müşteri tarafından gönderildi",
  "application.terms_accepted": "Başvuru Hizmet Şartları müşteri tarafından kabul edildi",
  "application.status_changed": "Başvuru durumu değişti",
  "application.visa_outcome_set": "Vize sonucu bildirildi",
  "appointment.completed": "Randevu saati geçti: randevu gerçekleşti olarak işaretlendi",
  "payment.declared_by_customer": "Müşteri ödeme yaptığını bildirdi",
  "payment.status_changed": "Ödeme durumu değişti",
  "appointment.updated": "Randevu bilgisi güncellendi",
  "appointment.preferences_saved": "Müşteri randevu tercihlerini kaydetti",
  "form.lock_changed": "Form kilidi değişti",
  "document.review_changed": "Belge incelemesi güncellendi",
  "document.not_applicable_changed": "Müşteri “geçerli değil” beyanını değiştirdi",
  "file.uploaded": "Dosya yüklendi",
  "file.deleted": "Dosya silindi",
  "file.viewed": "Dosya görüntülendi / indirildi",
  "export.zip": "Tüm evraklar ZIP olarak indirildi",
  "form_pdf.downloaded": "Başvuru formu PDF'i indirildi",
  "task.completed_by_customer": "Müşteri görevi tamamladı",
  "customer.reminded": "Müşteriye hatırlatma gönderildi",
  "customer.form_edit_declined": "Müşterinin form düzenleme isteği reddedildi",
  "form.edit_requested": "Müşteri form düzenleme isteği gönderdi",
  "form.correction_finished": "Müşteri form düzeltmesini tamamladı",
};

/** File type next to the "Dosya yüklendi" (file uploaded) row in the history. */
const FILE_KIND_TEXT: Record<string, string> = {
  document: "Belge",
  payment_receipt: "Dekont",
  staff_attachment: "Müşteriye gönderilen belge",
  visa_result: "Vize sonucu",
  appointment_letter: "Randevu belgesi",
  extra_document: "Ek evrak (müşteri gönderimden sonra ekledi)",
};

function auditDetail(entry: AuditEntry): string {
  const d = entry.details;
  const label = (map: Record<string, string>, value: unknown) => (typeof value === "string" ? (map[value] ?? value) : "");
  switch (entry.action) {
    case "application.status_changed":
      return `${applicationStatusLabel(d.from)} → ${applicationStatusLabel(d.to)}${d.automatic === true ? " (otomatik)" : ""}`;
    case "payment.status_changed":
      return `${label(PAYMENT_STATUS_LABELS, d.from)} → ${label(PAYMENT_STATUS_LABELS, d.to)}`;
    case "appointment.updated":
      return `${appointmentStatusLabel(d.status_from)} → ${appointmentStatusLabel(d.status_to)}${d.date_changed ? " (tarih değişti)" : ""}`;
    case "document.review_changed":
      return `${label(DOCUMENT_REVIEW_STATUS_LABELS, d.from)} → ${label(DOCUMENT_REVIEW_STATUS_LABELS, d.to)}`;
    case "application.visa_outcome_set":
      return d.outcome === "approved" ? "Onaylandı" : d.outcome === "refused" ? "Reddedildi" : "";
    case "form.lock_changed":
      return d.locked ? "Kapatıldı" : "Müşteri düzenlemesine açıldı";
    case "file.uploaded":
      return label(FILE_KIND_TEXT, d.kind);
    case "application.terms_accepted":
      return typeof d.version === "string" ? `Metin sürümü: ${d.version}` : "";
    case "export.zip":
      return `${d.outcome === "ok" ? "Tam" : d.outcome === "partial" ? "Eksik dosyalarla" : "Başarısız"} — ${Number(d.included ?? 0)} dosya${Number(d.failed ?? 0) > 0 ? `, ${Number(d.failed)} eksik` : ""}`;
    default:
      return "";
  }
}

const RISK_TONES: Record<RiskBandKey, AdminTone> = { best: "green", good: "green", medium: "navy", needs_work: "yellow", not_advised: "red" };

// --- Small parts ----------------------------------------------------------------------------------------------------

function AdminFileRow({ file }: { file: ApplicationFile }) {
  const small = adminButton("secondary", "sm");
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-dash-line py-2.5 pl-3.5 pr-3">
      <FileText aria-hidden className="size-[18px] flex-none text-dash-ink-2" strokeWidth={2.5} />
      <div className="mr-auto flex min-w-0 flex-col">
        <span className="truncate text-sm font-bold">{file.originalName}</span>
        <span className="text-xs text-dash-ink-3">
          {formatFileSize(file.sizeBytes)} · {formatDateTimeTr(file.createdAt)}
        </span>
      </div>
      <a href={`/api/files/${file.id}`} target="_blank" rel="noopener noreferrer" className={small}>
        Görüntüle<span className="sr-only">: {file.originalName} (yeni sekmede açılır)</span>
      </a>
      <a href={`/api/files/${file.id}?download=1`} className={small}>
        İndir<span className="sr-only">: {file.originalName}</span>
      </a>
    </div>
  );
}

function Labeled({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <span className="text-xs text-dash-ink-3">{label}</span>
      {children}
    </div>
  );
}

const STAGE_CIRCLE: Record<DetailStage["state"], string> = {
  done: "bg-dash-green",
  current: "border-4 border-dash-red bg-white",
  customer: "border-4 border-dash-yellow-accent bg-dash-draft-bg",
  waiting: "border-[1.5px] border-dash-dot bg-white",
  skipped: "border-[1.5px] border-dashed border-dash-dot bg-dash-subtle",
  cancelled: "bg-dash-red",
};
const STAGE_LABEL: Record<DetailStage["state"], string> = {
  done: "font-semibold text-dash-navy",
  current: "font-extrabold text-dash-navy",
  customer: "font-extrabold text-dash-navy",
  waiting: "font-semibold text-dash-ink-3",
  skipped: "font-semibold text-dash-ink-3",
  cancelled: "font-extrabold text-dash-navy",
};
const STAGE_SUB: Record<DetailStage["state"], string> = {
  done: "text-dash-green-ink",
  current: "text-dash-red",
  customer: "text-dash-draft-ink",
  waiting: "text-dash-ink-4",
  skipped: "text-dash-ink-3",
  cancelled: "text-dash-red",
};
const STAGE_SR: Record<DetailStage["state"], string> = {
  done: "tamamlandı",
  current: "şu anki aşama",
  customer: "müşteride",
  waiting: "bekliyor",
  skipped: "gerekmedi",
  cancelled: "iptal edildi",
};

function StageLine({ stages }: { stages: DetailStage[] }) {
  return (
    <ol aria-label="Başvurunun aşamaları" className="grid grid-cols-1 gap-3 border-t border-dash-line-soft pt-[18px] min-[760px]:grid-cols-6 min-[760px]:gap-0">
      {stages.map((stage, i) => (
        <li key={stage.name} className="flex items-start gap-3 min-[760px]:flex-col min-[760px]:gap-2">
          <div className="flex items-center min-[760px]:w-full">
            <span className={cn("grid size-[22px] flex-none place-items-center rounded-full", STAGE_CIRCLE[stage.state])}>
              {stage.state === "done" ? <Check aria-hidden className="size-3 text-white" strokeWidth={3.5} /> : null}
              {stage.state === "cancelled" ? <X aria-hidden className="size-[11px] text-white" strokeWidth={3.5} /> : null}
            </span>
            {i < stages.length - 1 ? (
              <span
                aria-hidden
                className={cn("mx-1.5 hidden h-0.5 flex-1 min-[760px]:block", stage.state === "done" || stage.state === "skipped" ? "bg-dash-green" : "bg-dash-line")}
              />
            ) : null}
          </div>
          <div className="flex min-w-0 flex-col gap-1 min-[760px]:gap-1">
            <span className={cn("pr-2.5 text-[13px] leading-[1.3]", STAGE_LABEL[stage.state])}>
              {stage.name}
              <span className="sr-only"> ({STAGE_SR[stage.state]})</span>
            </span>
            <span className={cn("text-xs", STAGE_SUB[stage.state])}>{stage.sub}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

type MissingItem = { kind: string; title: string; sub: string; action: ReactNode };

// --- General tab ----------------------------------------------------------------------------

function GeneralTab({ detail }: { detail: StaffApplicationDetail }) {
  const { application } = detail;
  const id = application.id;
  const key = adminStateKey(application);
  const owner = ADMIN_STATES[key].owner;
  const modes = { ...SECTION_MODES[key] };
  const closed = key === "g" || key === "h";

  const slotStates = detail.slots.map((slot) => ({ ...slot, fileCount: slot.files.length }));
  const inScope = detail.slots.filter((slot) => !slot.outOfScope);
  const outstanding = outstandingCustomerActions({ status: application.status, formLocked: application.formLocked, slots: slotStates, tasks: detail.tasks });
  const approved = inScope.filter((slot) => slot.reviewStatus === "approved").length;
  const problems = inScope.filter((slot) => slot.reviewStatus === "needs_correction" || slot.reviewStatus === "missing");
  const unreviewed = inScope.filter((slot) => slot.files.length > 0 && slot.reviewStatus === "pending").length;
  const unchecked = inScope.filter((slot) => slot.files.length > 0 && slot.reviewStatus !== "approved").length;
  const openTasks = detail.tasks.filter((task) => task.status === "open");
  const doneTasks = detail.tasks.filter((task) => task.status !== "open");

  // History is sorted newest first; the latest record of the event in question is used.
  const latest = (match: (entry: AuditEntry) => boolean) => detail.audit.find(match) ?? null;
  const statusTo = (to: string) => latest((e) => e.action === "application.status_changed" && e.details.to === to);
  const documentsCompleteAt = statusTo("documents_complete")?.createdAt ?? null;
  const cancelEntry = application.status === "cancelled" ? statusTo("cancelled") : null;
  const extraClosedAt = latest((e) => e.action === "application.status_changed" && e.details.from === "awaiting_customer" && e.details.to === "in_review")?.createdAt ?? null;
  const reminder = latest((e) => e.action === "customer.reminded");
  const formOpened = latest((e) => e.action === "form.lock_changed" && e.details.locked === false);
  const outcomeEntry = latest((e) => e.action === "application.visa_outcome_set");
  const cancelReason = detail.notes.find((note) => note.body.startsWith(CANCEL_REASON_PREFIX))?.body.slice(CANCEL_REASON_PREFIX.length) ?? null;
  const extraRequested = extraDocumentsFrom(slotStates).requested || detail.audit.some((e) => e.action === "application.status_changed" && e.details.to === "awaiting_customer");
  const paymentVerified = application.paymentStatus === "verified";
  // The appointment date is only used for a sent or completed appointment (old records may hold a date left over from the
  // preference stage).
  const appointmentAt = application.appointmentStatus === "scheduled" || application.appointmentStatus === "completed" ? application.appointmentAt : null;
  if (key === "h" && !paymentVerified) modes.pay = "locked";

  const next = nextStep({
    key,
    missingCount: outstanding.documents + outstanding.tasks + (outstanding.form ? 1 : 0),
    appointment: { at: appointmentAt, location: application.appointmentLocation },
    visaOutcome: detail.visaOutcome ? { outcome: detail.visaOutcome.outcome, at: detail.visaOutcome.at } : null,
    cancel: { at: cancelEntry?.createdAt ?? null, by: cancelEntry?.actorName ?? null, reason: cancelReason },
  });
  const stages = detailStages({
    key,
    paymentVerifiedAt: paymentVerified ? application.paymentReviewedAt : null,
    documentsCompleteAt,
    extraRequested,
    extraClosedAt,
    appointmentAt,
    visaOutcome: detail.visaOutcome ? { outcome: detail.visaOutcome.outcome, at: detail.visaOutcome.at } : null,
    cancelledStage: stageOfStatus(detail.cancelledFromStatus),
    cancelledAt: cancelEntry?.createdAt ?? null,
  });
  const [ownerLabel, ownerTone] = OWNER_LABELS[next.owner];

  // Missing items list (draft, payment refused, with customer).
  const small = adminButton("secondary", "sm");
  const missing: MissingItem[] = [];
  if (key === "draft") {
    missing.push({
      kind: "Form",
      title: "Başvuru formu gönderilmedi",
      sub: `Son kayıt ${formatDateTimeTr(application.updatedAt)}`,
      action: (
        <Link href={staffApplicationPath(id, "form")} className={small}>
          Form cevaplarına git
        </Link>
      ),
    });
  }
  if (key === "payRejected") {
    const receipt = detail.receipts.at(-1) ?? detail.receipts[0];
    missing.push({
      kind: "Ödeme",
      title: "Yeni ödeme dekontu",
      sub: application.paymentNote ? `Ret gerekçesi: ${application.paymentNote}` : "Müşteriden yeni dekont bekleniyor",
      action: receipt ? (
        <a href={`/api/files/${receipt.id}`} target="_blank" rel="noopener noreferrer" className={small}>
          Eski dekontu görüntüle
        </a>
      ) : null,
    });
  }
  if (key === "c") {
    for (const slot of problems) {
      missing.push({
        kind: "Belge",
        title: slot.label,
        sub: `${slot.reviewStatus === "missing" ? "Eksik" : "Yeniden istendi"}${slot.reviewNote ? ` · ${slot.reviewNote}` : ""}`,
        action: (
          <Link href={`${staffApplicationPath(id, "documents")}#${documentAnchor(slot.id)}`} className={small}>
            Belgeyi görüntüle
          </Link>
        ),
      });
    }
    for (const slot of inScope.filter((s) => s.requestedByStaff && s.files.length === 0 && s.reviewStatus === "pending")) {
      missing.push({
        kind: "Belge",
        title: slot.label,
        sub: "Yeni belge isteği · Müşteri henüz yüklemedi",
        action: (
          <Link href={`${staffApplicationPath(id, "documents")}#${documentAnchor(slot.id)}`} className={small}>
            Belgeyi görüntüle
          </Link>
        ),
      });
    }
    for (const task of openTasks) {
      missing.push({
        kind: "Görev",
        title: task.title,
        sub: [task.description, formatDateTimeTr(task.createdAt)].filter(Boolean).join(" · "),
        action: (
          <InlineActionButton className={small} action={setTaskStatusAction.bind(null, id, task.id, "completed")}>
            Tamamlandı
          </InlineActionButton>
        ),
      });
    }
    if (!application.formLocked) {
      missing.push({
        kind: "Form",
        title: "Başvuru formu düzeltmesi",
        sub: "Form müşterinin düzenlemesine açık",
        action: (
          <InlineActionButton className={small} action={setFormLockAction.bind(null, id, true)}>
            Formu kapat
          </InlineActionButton>
        ),
      });
    }
  }

  const appointment = appointmentAt ? appointmentParts(appointmentAt) : null;
  const scheduled = application.appointmentStatus === "scheduled" && appointment;
  const appointmentText = appointment && appointmentAt ? `${shortDate(appointmentAt)} ${appointment.weekday} · ${appointment.time}` : "";
  const locations = detail.appointmentLocations?.filter((l) => l.isActive).map((l) => ({ id: l.id, name: l.name, address: l.address })) ?? null;
  const current = istanbulParts(scheduled ? application.appointmentAt : null);
  const complete = canMarkDocumentsComplete(application.status, outstanding);

  const actionsData: DetailActionsData = {
    applicationId: id,
    status: application.status,
    paymentStatus: application.paymentStatus,
    formLocked: application.formLocked,
    documents: inScope.map((slot) => ({
      id: slot.id,
      label: slot.label,
      state: `${slot.files.length === 0 ? "Dosya yok" : `${slot.files.length} dosya`} · ${DOCUMENT_REVIEW_STATUS_LABELS[slot.reviewStatus]}`,
    })),
    uncheckedDocuments: unchecked,
    completeBlocked: complete.ok ? null : complete.message,
    preferences: detail.preferences.map((p) => ({ rank: p.rank, date: p.date, label: `${DAY_MONTH_SHORT.format(utcDate(p.date))} · ${APPOINTMENT_SLOT_LABELS[p.slot]}` })),
    locations,
    appointment: {
      ...current,
      locationId: application.appointmentLocationId ?? "",
      note: application.appointmentNote ?? "",
      scheduled: application.appointmentStatus === "scheduled",
      letter: detail.appointmentLetter ? { id: detail.appointmentLetter.id, name: detail.appointmentLetter.originalName } : null,
    },
    today: todayInIstanbul(),
    visa: detail.visaOutcome ? { outcome: detail.visaOutcome.outcome, note: detail.visaOutcome.note ?? "", hasFile: detail.visaOutcome.file !== null } : null,
    maxBytes: maxUploadBytes(),
    referenceCode: application.referenceCode,
    canDelete: detail.user.isAdmin,
  };

  const personal = detail.formData.personal ?? {};
  const contact = detail.formData.contact ?? {};
  const applicant = `${str(personal.firstName)} ${str(personal.lastName)}`.trim();
  const birthDate = str(personal.birthDate) || detail.customer.birthDate;
  const risk = detail.riskAssessment ? riskTestStaffSummary(detail.riskAssessment.answers) : null;

  const showRequest = !["draft", "cancelled", "result_communicated"].includes(application.status);
  const canPrefs = canManageAppointment(application.status).ok;
  const canCancel = canCancelApplication(application.status).ok;
  const sideButton = (tone: "default" | "danger" = "default") =>
    adminButton(tone === "danger" ? "dangerOutline" : "secondary", "md", "w-full");

  const payPill: [string, AdminTone] =
    key === "a" ? ["Kontrol ediliyor", "navy"] : key === "payRejected" ? ["Reddedildi", "red"] : key === "awaitingPayment" ? ["Ödeme bekleniyor", "yellow"] : paymentVerified ? ["Doğrulandı", "green"] : ["Bekleniyor", "gray"];
  const reviewer = detail.paymentReviewerName ? ` · ${detail.paymentReviewerName}` : "";
  const payDecision =
    application.paymentStatus === "verified"
      ? `Doğrulandı · ${shortDateTimeText(application.paymentReviewedAt)}${reviewer}`
      : application.paymentStatus === "rejected"
        ? `Reddedildi · ${shortDateTimeText(application.paymentReviewedAt)}${reviewer}${application.paymentNote ? ` · Gerekçe: ${application.paymentNote}` : ""}`
        : "Henüz karar verilmedi";
  const rvPill: [string, AdminTone] = key === "b" ? ["İnceleniyor", "navy"] : key === "c" ? ["Müşteride", "yellow"] : ["Tamamlandı", "green"];
  const apptPill: [string, AdminTone] =
    application.appointmentStatus === "scheduled"
      ? ["Bildirildi", "green"]
      : application.appointmentStatus === "preferences_requested"
        ? ["Yeni tercih bekleniyor", "yellow"]
        : ["Bildirilmedi", "navy"];
  const summary = (mode: SectionMode, texts: Partial<Record<SectionMode, string>>) => texts[mode] ?? "";
  const cancelledText = key === "h" ? "Başvuru iptal edildi" : null;

  return (
    <DetailActionsProvider data={actionsData}>
      <div className="grid items-start gap-12 min-[1000px]:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-w-0 flex-col gap-4">
          {application.formEditRequestedAt && application.formLocked ? (
            // The customer's form edit request: accept = open the form, refuse = reason.
            <section aria-labelledby="form-request" className="flex flex-col gap-3 rounded-[22px] border-[1.5px] border-dash-yellow-border bg-dash-yellow-row px-6 py-[18px]">
              <div className="flex flex-col gap-1">
                <AdminEyebrow>MÜŞTERİ İSTEĞİ</AdminEyebrow>
                <h2 id="form-request" className="text-lg font-extrabold">
                  Müşteri formda değişiklik yapmak istiyor
                </h2>
                <p className="text-xs text-dash-ink-3">{formatDateTimeTr(application.formEditRequestedAt)}</p>
              </div>
              {application.formEditRequestNote ? <p className="whitespace-pre-line text-[15px] leading-[1.6]">{application.formEditRequestNote}</p> : null}
              <div className="flex flex-wrap gap-2">
                <OpenModalButton modal="openForm" className={adminButton("primary", "md")}>
                  Formu düzenlemeye aç
                </OpenModalButton>
                <OpenModalButton modal="declineFormEdit" className={adminButton("secondary", "md")}>
                  Reddet
                </OpenModalButton>
              </div>
            </section>
          ) : null}
          <section aria-labelledby="next-task" className="flex flex-col gap-[18px] rounded-[22px] border border-dash-line bg-white px-6 py-[22px]">
            <DetailFeedback />
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2.5">
                <AdminEyebrow>SIRADAKİ İŞ</AdminEyebrow>
                <AdminPill tone={ownerTone} size="sm">
                  {ownerLabel}
                </AdminPill>
              </div>
              <div className="flex flex-wrap items-center gap-[18px]">
                <div className="flex min-w-0 flex-1 basis-[320px] flex-col gap-2.5">
                  <h2 id="next-task" className="text-2xl font-extrabold tracking-[-0.02em]">
                    {next.title}
                  </h2>
                  <p className="max-w-[640px] text-[15px] leading-[1.6] text-dash-ink-2 [text-wrap:pretty]">{next.desc}</p>
                  {next.highlight ? (
                    <div className="flex max-w-[640px] flex-col gap-1 rounded-[16px] border border-dash-red-border bg-dash-red-tint px-4 py-3">
                      <span className="text-xs font-extrabold tracking-[0.08em] text-dash-red">{next.highlight.label.toLocaleUpperCase("tr-TR")}</span>
                      <span className="whitespace-pre-line text-base font-bold text-dash-navy">{next.highlight.text}</span>
                    </div>
                  ) : null}
                </div>
                {key === "d2" && appointment ? (
                  <div className="ml-auto flex flex-none items-center gap-3.5">
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="text-lg font-extrabold">
                        {appointment.day} {appointment.month} {appointment.weekday}
                      </span>
                      <span className="text-sm text-dash-ink-2">Saat {appointment.time} (TSİ)</span>
                    </div>
                    <div aria-hidden className="w-[86px] overflow-hidden rounded-[16px] border-[1.5px] border-dash-line bg-white text-center shadow-[0_2px_0_var(--color-dash-line)]">
                      <div className="bg-dash-red py-[5px] text-[11px] font-extrabold tracking-[0.1em] text-white">{appointment.month.toLocaleUpperCase("tr-TR")}</div>
                      <div className="pb-0.5 pt-2 text-4xl font-extrabold leading-none tracking-[-0.02em]">{appointment.day}</div>
                      <div className="pb-2 text-[11px] font-semibold text-dash-ink-2">{appointment.weekday}</div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            {missing.length > 0 ? (
              <ul aria-label="Müşteriden beklenenler" className="flex flex-col overflow-hidden rounded-[16px] border border-dash-yellow-border">
                {missing.map((item, i) => (
                  <li key={`${item.kind}-${item.title}-${i}`} className="flex flex-wrap items-center gap-3 border-b border-dash-yellow-line bg-dash-yellow-row px-4 py-3 last:border-b-0">
                    <span className="w-[52px] flex-none rounded-full bg-dash-draft-bg px-[9px] py-[3px] text-center text-[11px] font-bold text-dash-draft-ink">{item.kind}</span>
                    <div className="mr-auto flex min-w-0 flex-1 basis-[180px] flex-col">
                      <span className="text-sm font-bold">{item.title}</span>
                      {item.sub ? <span className="text-xs text-dash-ink-3">{item.sub}</span> : null}
                    </div>
                    {item.action}
                  </li>
                ))}
              </ul>
            ) : null}

            {next.primary || next.secondary.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                {next.primary ? <NextStepButton action={next.primary} variant="primary" /> : null}
                {next.secondary.map((action) => (
                  <NextStepButton key={action} action={action} variant="secondary" />
                ))}
                {next.notify ? (
                  <span className="ml-1.5 flex items-center gap-1.5 text-xs text-dash-ink-3">
                    <Bell aria-hidden className="size-3.5" strokeWidth={2.5} />
                    {next.notify}
                  </span>
                ) : null}
              </div>
            ) : null}
            {owner === "customer" ? (
              <p className="text-[13px] text-dash-ink-2">
                {reminder ? (
                  <>
                    Son hatırlatma: <strong className="text-dash-navy">{formatDateTimeTr(reminder.createdAt)}</strong> ·{" "}
                    {isEmailConfigured() ? "e-posta ve panel bildirimi" : "panel bildirimi"}
                  </>
                ) : (
                  "Henüz hatırlatma gönderilmedi."
                )}
              </p>
            ) : null}
            <StageLine stages={stages} />
          </section>

          {/* Payment */}
          <DetailSection
            id="section-payment"
            title="Ödeme"
            mode={modes.pay}
            canExpand={modes.pay === "done"}
            summary={summary(modes.pay, {
              done: `Doğrulandı · ${shortDateTimeText(application.paymentReviewedAt)}${reviewer}`,
              locked: key === "h" ? "Başvuru ödeme doğrulanmadan iptal edildi" : "Form gönderilince ödeme kontrolü başlar",
            })}
            header={<AdminPill tone={payPill[1]} size="sm">{payPill[0]}</AdminPill>}
          >
            <div className="grid gap-5 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <Labeled label="Müşteri bildirimi">
                <span>{application.paymentDeclaredAt ? `“Ödemeyi yaptım” · ${formatDateTimeTr(application.paymentDeclaredAt)}` : "Henüz bildirilmedi"}</span>
              </Labeled>
              <Labeled label="Son karar">
                <span>{payDecision}</span>
              </Labeled>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-dash-ink-3">{detail.receipts.length > 1 ? "Yüklenen dekontlar" : "Yüklenen dekont"}</span>
              {detail.receipts.length === 0 ? <span className="text-sm text-dash-ink-2">Dekont yüklenmedi.</span> : null}
              {detail.receipts.map((file) => (
                <AdminFileRow key={file.id} file={file} />
              ))}
            </div>
            <div className="flex items-start gap-2.5 rounded-[14px] bg-dash-subtle px-3.5 py-3 text-[13px] leading-normal text-dash-ink-2">
              <Info aria-hidden className="mt-0.5 size-4 flex-none text-dash-navy" strokeWidth={2.5} />
              <span>Müşterinin bildirimi ödemeyi doğrulamaz; tutarın banka hesabına geçtiğini kontrol edin. Ödeme doğrulanmadan inceleme aşaması başlamaz.</span>
            </div>
          </DetailSection>

          {/* Review and documents */}
          <DetailSection
            id="section-review"
            title="İnceleme ve evraklar"
            mode={modes.review}
            canExpand={modes.review === "done"}
            summary={summary(modes.review, {
              done: `Evraklar tamamlandı${documentsCompleteAt ? ` · ${shortDate(documentsCompleteAt)}` : ""} · ${approved} belge onaylı`,
              locked: cancelledText ?? "Ödeme doğrulanmadan inceleme başlamaz",
            })}
            header={<AdminPill tone={rvPill[1]} size="sm">{rvPill[0]}</AdminPill>}
          >
            <div className="flex flex-wrap items-center gap-6">
              <dl className="mr-auto flex gap-7">
                <div className="flex flex-col-reverse">
                  <dt className="text-xs text-dash-ink-3">Onaylı belge</dt>
                  <dd className="text-[22px] font-extrabold">{approved}</dd>
                </div>
                <div className="flex flex-col-reverse">
                  <dt className="text-xs text-dash-ink-3">Eksik / reddedildi</dt>
                  <dd className={cn("text-[22px] font-extrabold", problems.length > 0 && "text-dash-red")}>{problems.length}</dd>
                </div>
                <div className="flex flex-col-reverse">
                  <dt className="text-xs text-dash-ink-3">İncelenmedi</dt>
                  <dd className="text-[22px] font-extrabold">{unreviewed}</dd>
                </div>
              </dl>
              <Link href={staffApplicationPath(id, "documents")} className={adminButton("secondary", "sm", "h-[38px]")}>
                Evraklara git →
              </Link>
              <Link href={staffApplicationPath(id, "form")} className={adminButton("secondary", "sm", "h-[38px]")}>
                Form cevaplarına git →
              </Link>
            </div>
            {!application.formLocked && application.status !== "draft" ? (
              <div className="flex flex-wrap items-center gap-3.5 rounded-[14px] bg-dash-draft-bg py-3 pl-4 pr-3.5">
                <div className="mr-auto flex flex-col">
                  <span className="text-sm font-bold text-dash-draft-ink">Form müşterinin düzenlemesine açık</span>
                  <span className="text-xs text-dash-draft-ink">
                    {formOpened ? `${formatDateTimeTr(formOpened.createdAt)}’den beri · ` : ""}Kapatınca müşteriye bildirim gider
                  </span>
                </div>
                <InlineActionButton className={adminButton("secondary", "sm", "h-9 border-dash-yellow-button")} action={setFormLockAction.bind(null, id, true)}>
                  Formu kapat
                </InlineActionButton>
              </div>
            ) : key === "b" ? (
              <p className="text-[13px] text-dash-ink-2">Form müşterinin düzenlemesine kapalı. Düzeltme için “Ek evrak / düzeltme iste” ile açabilirsiniz.</p>
            ) : null}
            {application.status === "documents_complete" ? (
              <div className="flex flex-wrap items-center gap-2">
                <OpenModalButton modal="undoComplete" className={adminButton("secondary", "sm", "h-[38px]")}>
                  “Evraklar tamamlandı” işaretini geri al
                </OpenModalButton>
                <span className="text-xs text-dash-ink-3">Başvuru yeniden inceleme aşamasına döner.</span>
              </div>
            ) : (
              <p className="text-xs text-dash-ink-3">Müşteri tüm eksikleri tamamlayınca başvuru kendiliğinden incelemeye döner.</p>
            )}
          </DetailSection>

          {/* Customer tasks */}
          <DetailSection
            id="section-tasks"
            title="Müşteri görevleri"
            mode={modes.tasks}
            icon={modes.tasks === "row" ? "tasks" : undefined}
            canExpand={modes.tasks === "row"}
            expandLabel="Görev ekle / gör"
            summary={openTasks.length > 0 ? `${openTasks.length} açık · ${doneTasks.length} tamamlandı` : `Açık görev yok · ${doneTasks.length} tamamlandı`}
            description="Belge dışı istekler (ör. “Bizi arayınız”). Açık görev varken başvuru müşteride bekler."
          >
            <TaskPanel
              applicationId={id}
              tasks={detail.tasks.map((task) => ({
                id: task.id,
                title: task.title,
                meta: [task.description, formatDateTimeTr(task.createdAt)].filter(Boolean).join(" · "),
                status: task.status,
              }))}
            />
          </DetailSection>

          {/* Appointment */}
          <DetailSection
            id="section-appointment"
            title="Randevu"
            mode={modes.appt}
            summary={summary(modes.appt, {
              done: [appointmentText, application.appointmentLocation, "gerçekleşti"].filter(Boolean).join(" · "),
              locked: cancelledText ?? `Evraklar tamamlanmadan randevu bildirilemez · müşteri ${detail.preferences.length} tercih verdi`,
            })}
            header={<AdminPill tone={apptPill[1]} size="sm">{apptPill[0]}</AdminPill>}
          >
            {scheduled ? (
              <div className="flex flex-col gap-3.5">
                <div className="grid gap-4 text-sm sm:grid-cols-3">
                  <Labeled label="Tarih ve saat (Türkiye saati)">
                    <span className="font-bold">{appointmentText}</span>
                  </Labeled>
                  <Labeled label="Yer">
                    <span className="font-bold">{application.appointmentLocation ?? "—"}</span>
                    {application.appointmentAddress ? <span className="whitespace-pre-line text-xs text-dash-ink-3">{application.appointmentAddress}</span> : null}
                  </Labeled>
                  <Labeled label="Not">
                    <span>{application.appointmentNote || "—"}</span>
                  </Labeled>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-dash-ink-3">Randevu belgesi (appointment letter)</span>
                  {detail.appointmentLetter ? (
                    <AdminFileRow file={detail.appointmentLetter} />
                  ) : (
                    <span className="text-sm text-dash-ink-2">Yüklenmedi. “Düzenle” ile ekleyebilirsiniz.</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <OpenModalButton modal="appt" className={adminButton("secondary", "sm", "h-[38px]")} disabled={!locations || locations.length === 0}>
                    Düzenle
                  </OpenModalButton>
                  <OpenModalButton modal="withdrawAppt" className={adminButton("dangerOutline", "sm", "h-[38px]")}>
                    Randevuyu geri çek
                  </OpenModalButton>
                  <span className="text-xs text-dash-ink-3">İki işlemde de müşteriye bildirim gider.</span>
                </div>
                <AdminNote>Randevu saati geçince başvuru kendiliğinden “Sonuç bekleniyor” aşamasına geçer.</AdminNote>
              </div>
            ) : null}
            <div className="flex flex-col gap-2">
              <span className="text-sm font-bold">Müşterinin randevu tercihleri</span>
              {detail.appointmentOutsideWindow ? (
                <AdminNote tone="warning">Müşteri, sunulan tarihlerin hiçbirinin uymadığını belirtti. Aşağıdakiler, daha ileri tarihlerde uygun olduğu günlerdir.</AdminNote>
              ) : null}
              {detail.preferences.length === 0 ? (
                <p className="text-sm text-dash-ink-2">
                  {application.appointmentStatus === "preferences_requested" ? "Müşteriden yeni tercih bekleniyor." : "Tercih bildirilmedi."}
                </p>
              ) : (
                <ol className="flex flex-col overflow-hidden rounded-[14px] border border-dash-line">
                  {detail.preferences.map((p) => (
                    <li
                      key={p.rank}
                      className="grid grid-cols-[32px_minmax(0,1fr)] items-center gap-x-2 border-b border-dash-line-faint px-3.5 py-2.5 text-sm last:border-b-0 sm:grid-cols-[40px_minmax(0,1fr)_120px_130px]"
                    >
                      <span className="font-extrabold text-dash-ink-3">{p.rank}.</span>
                      <span className="font-bold">{DAY_MONTH_YEAR.format(utcDate(p.date))}</span>
                      <span className="col-start-2 text-dash-ink-2 sm:col-start-auto">{WEEKDAY.format(utcDate(p.date))}</span>
                      <span className="col-start-2 text-dash-ink-2 sm:col-start-auto">{APPOINTMENT_SLOT_LABELS[p.slot]}</span>
                    </li>
                  ))}
                </ol>
              )}
              <span className="text-xs text-dash-ink-3">Tercihler kesin randevu değildir.</span>
            </div>
          </DetailSection>

          {/* Visa outcome */}
          <DetailSection
            id="section-outcome"
            title="Vize sonucu"
            mode={modes.visa}
            summary={summary(modes.visa, { locked: cancelledText ?? "Randevu gerçekleşmeden sonuç bildirilemez", current: "Henüz bildirilmedi" })}
            header={
              detail.visaOutcome ? (
                <AdminPill tone={detail.visaOutcome.outcome === "approved" ? "green" : "red"} size="sm">
                  {detail.visaOutcome.outcome === "approved" ? "Onaylandı" : "Reddedildi"}
                </AdminPill>
              ) : null
            }
          >
            {detail.visaOutcome ? (
              <>
                <div className="grid gap-4 text-sm sm:grid-cols-[200px_minmax(0,1fr)]">
                  <Labeled label="Bildirildi">
                    <span>{formatDateTimeTr(detail.visaOutcome.at)}</span>
                    {outcomeEntry?.actorName ? <span className="text-xs text-dash-ink-3">{outcomeEntry.actorName}</span> : null}
                  </Labeled>
                  <Labeled label="Müşteriye giden mesaj">
                    <span className="whitespace-pre-line leading-normal">{detail.visaOutcome.note || "—"}</span>
                  </Labeled>
                </div>
                <div className="flex flex-wrap items-center gap-2.5 text-sm">
                  {detail.visaOutcome.file ? (
                    <>
                      <Paperclip aria-hidden className="size-4 text-dash-ink-2" strokeWidth={2.5} />
                      <a href={`/api/files/${detail.visaOutcome.file.id}`} target="_blank" rel="noopener noreferrer" className="font-bold">
                        Sonuç dosyasını görüntüle
                      </a>
                    </>
                  ) : null}
                  <OpenModalButton modal="result" className={adminButton("ghost", "xs", "ml-auto h-8 px-3")}>
                    Sonucu düzelt
                  </OpenModalButton>
                </div>
              </>
            ) : (
              <p className="text-sm text-dash-ink-2">Sonuç henüz bildirilmedi.</p>
            )}
          </DetailSection>
        </div>

        <aside className="flex flex-col gap-[22px] pt-1.5" aria-label="Başvuru bilgileri ve diğer işlemler">
          <section className="flex flex-col gap-3 border-b border-dash-side-line pb-[22px]">
            <h2 className="text-[15px] font-extrabold">Kişiler</h2>
            <div className="flex flex-col gap-0.5 text-sm">
              <span className="text-xs text-dash-ink-3">Başvuru sahibi</span>
              <span className="font-bold">{applicant || "Form henüz doldurulmadı"}</span>
              {str(contact.mobilePhone) ? <span className="text-dash-ink-2">{str(contact.mobilePhone)}</span> : null}
            </div>
            <div className="flex flex-col gap-0.5 border-t border-dash-line-faint pt-2.5 text-sm">
              <span className="text-xs text-dash-ink-3">Hesap sahibi</span>
              <span className="font-bold">{detail.customer.name}</span>
              <span className="break-all text-dash-ink-2">{detail.customer.email}</span>
            </div>
          </section>
          <section className="flex flex-col gap-2.5 border-b border-dash-side-line pb-[22px]">
            <h2 className="text-[15px] font-extrabold">Başvuru bilgileri</h2>
            <dl className="grid grid-cols-[100px_minmax(0,1fr)] gap-x-2.5 gap-y-2 text-[13px]">
              <dt className="text-dash-ink-3">Numara</dt>
              <dd>{application.referenceCode}</dd>
              <dt className="text-dash-ink-3">Tip / alt tip</dt>
              <dd>{application.applicationTypes.length > 0 ? application.applicationTypes.map((t) => APPLICATION_TYPE_LABELS[t]).join(" · ") : "—"}</dd>
              <dt className="text-dash-ink-3">Sponsor</dt>
              <dd>{application.sponsorStatus ? SPONSOR_STATUS_LABELS[application.sponsorStatus] : "—"}</dd>
              <dt className="text-dash-ink-3">Doğum tarihi</dt>
              <dd>{birthDate ? formatDateTr(birthDate) : "—"}</dd>
              <dt className="text-dash-ink-3">Şehir</dt>
              <dd>{detail.cityName ?? "—"}</dd>
              <dt className="text-dash-ink-3">Gönderim</dt>
              <dd>{application.submittedAt ? formatDateTimeTr(application.submittedAt) : "Gönderilmedi"}</dd>
            </dl>
          </section>
          <section className="flex flex-col gap-2 border-b border-dash-side-line pb-[22px]">
            <h2 className="text-[15px] font-extrabold">Risk Analiz Testi</h2>
            {risk && detail.riskAssessment ? (
              <>
                <AdminPill tone={RISK_TONES[risk.bandKey]} size="sm" className="self-start">
                  {risk.badge}
                </AdminPill>
                <span className="text-xs text-dash-ink-3">
                  {formatDateTimeTr(detail.riskAssessment.completedAt)}
                  {risk.flags.length > 0 ? ` · Dikkat edilmesi gereken ${risk.flags.length} nokta` : ""}
                </span>
                <RiskAnswersButton answers={risk.answers} flags={risk.flags} dateText={formatDateTimeTr(detail.riskAssessment.completedAt)} />
              </>
            ) : (
              <span className="text-[13px] text-dash-ink-2">Müşteri Risk Analiz Testi’ni yapmadı.</span>
            )}
          </section>
          <section className="flex flex-col gap-2 border-b border-dash-side-line pb-[22px]">
            <h2 className="mb-0.5 text-[15px] font-extrabold">Diğer işlemler</h2>
            {showRequest ? (
              <OpenModalButton modal="request" className={sideButton()}>
                Ek evrak / düzeltme iste
              </OpenModalButton>
            ) : null}
            {!closed && canPrefs ? (
              <OpenModalButton modal="prefs" className={sideButton()} disabled={application.appointmentStatus === "preferences_requested"}>
                Yeni randevu tercihi iste
              </OpenModalButton>
            ) : null}
            {!closed && application.appointmentStatus === "preferences_requested" ? (
              <span className="text-xs text-dash-ink-3">Müşteriden yeni randevu tercihi bekleniyor.</span>
            ) : null}
            {!closed && canCancel ? (
              <OpenModalButton modal="cancel" className={sideButton("danger")}>
                Başvuruyu iptal et
              </OpenModalButton>
            ) : null}
            {actionsData.canDelete ? (
              <OpenModalButton modal="deleteApplication" className={sideButton("danger")}>
                Başvuruyu kalıcı olarak sil
              </OpenModalButton>
            ) : null}
            {key === "draft" ? <span className="text-xs leading-normal text-dash-ink-3">Başvuru gönderilmeden işlem yapılamaz.</span> : null}
            {closed ? <span className="text-xs leading-normal text-dash-ink-3">Kapanmış başvuruda bu işlemler yapılamaz.</span> : null}
            <span className="text-xs leading-normal text-dash-ink-3">Tüm işlemler müşteriye bildirim gönderir. Ek evrak / düzeltme her aşamada istenebilir.</span>
          </section>
          <span className="px-1.5 text-xs leading-normal text-dash-ink-3">Her karar kim / ne zaman bilgisiyle İşlem geçmişi sekmesine kaydedilir.</span>
        </aside>
      </div>
    </DetailActionsProvider>
  );
}

// --- Other tabs ---------------------------------------------------------------------------------------------------

function FormTab({ detail }: { detail: StaffApplicationDetail }) {
  const validation = validateForm(pruneFormData(detail.formData), todayInIstanbul());
  const incomplete = Object.values(validation.sections).filter((s) => s.errorCount > 0).length;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {incomplete > 0 ? (
          <AdminNote tone="warning" role="status" className="mr-auto flex-1 basis-[320px]">
            Formun {incomplete} bölümünde eksik veya hatalı alan var.
            {detail.application.status === "draft" ? " Başvuru henüz taslak olduğu için bu beklenen bir durumdur." : ""}
          </AdminNote>
        ) : (
          <span className="mr-auto" />
        )}
        <a href={`/api/admin/applications/${detail.application.id}/form-pdf`} className={adminButton("secondary", "md")}>
          <FileText aria-hidden className="size-4" strokeWidth={2.5} />
          Doldurulmuş formu PDF olarak indir
        </a>
      </div>
      <FormAnswers
        formData={detail.formData}
        look="wizard"
        sectionNotice={(sectionId) => {
          const count = validation.sections[sectionId].errorCount;
          return count > 0 ? <p className="mb-3 text-sm font-bold text-dash-draft-ink">Bu bölümde {count} eksik veya hatalı alan var.</p> : null;
        }}
      />
    </div>
  );
}

function DocumentsTab({ detail }: { detail: StaffApplicationDetail }) {
  const maxBytes = maxUploadBytes();
  const { application } = detail;
  // Extra documents no consultant has opened yet (same rule as the "Yeni ek evrak" (new extra document) marker in the list).
  const unseenExtras = unseenExtraDocumentIds(
    detail.extraDocuments.map((f) => ({ id: f.id, kind: f.kind, status: "ready" })),
    viewedFileIdsFrom(detail.audit),
  ).length;
  return (
    <div className="flex flex-col gap-4">
      <AdminCard as="div" className="flex-row flex-wrap items-center gap-4">
        <p className="mr-auto max-w-xl flex-1 basis-[320px] text-sm leading-6 text-dash-ink-2">
          Belgeleri tek tek açabilir veya tümünü ZIP olarak indirebilirsiniz. Her belgeyi “Uygun” ile işaretleyiniz. “Sorun bildir” ile yazdığınız not
          müşteriye gider, müşteri o belgeyi yeniden yükleyebilir ve başvuru kendiliğinden “Müşteriden işlem bekleniyor” aşamasına geçer.
        </p>
        <ExportButton applicationId={application.id} buttonClassName={adminButton("primary", "md")} label="Tüm evraklar (ZIP)" floating />
      </AdminCard>

      {detail.slots.length === 0 ? (
        <p className="text-sm text-dash-ink-2">Bu başvuru için henüz evrak listesi oluşmadı (müşteri başvuru tipini seçmedi).</p>
      ) : (
        <div className="flex flex-col gap-3">
          {detail.slots.map((slot) => (
            <DocumentReviewCard
              key={slot.id}
              applicationId={application.id}
              maxBytes={maxBytes}
              reviewable={application.status !== "draft"}
              slot={{
                id: slot.id,
                label: slot.label,
                description: slot.description,
                requirement: slot.requirement,
                isCustomRequest: slot.documentTypeId === null,
                outOfScope: slot.outOfScope,
                reviewStatus: slot.reviewStatus,
                reviewNote: slot.reviewNote,
                zipFolderName: slot.zipFolderName,
                attachment: slot.attachment ? fileItem(slot.attachment) : null,
                files: slot.files.map(fileItem),
                maxFiles: slot.maxFiles,
              }}
            />
          ))}
        </div>
      )}

      {detail.extraDocuments.length > 0 ? (
        <AdminCard aria-labelledby="extra-documents-card" className="gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="extra-documents-card" className="text-lg font-extrabold tracking-[-0.02em]">
              Müşterinin gönderdiği ek evraklar ({detail.extraDocuments.length})
            </h2>
            {unseenExtras > 0 ? (
              <AdminPill tone="navy" size="sm" className="self-start">
                {unseenExtras} yeni — açınca “yeni” işareti kalkar
              </AdminPill>
            ) : null}
            <p className="text-[13px] text-dash-ink-2">
              Müşteri başvuruyu gönderdikten sonra kendisi ekledi; müşteri silemez. ZIP’te kök dizinde “Ek evrak” adıyla yer alır. Sınır Ayarlar →
              Genel’dedir.
            </p>
          </div>
          <ul className="flex flex-col gap-2">
            {detail.extraDocuments.map((file) => (
              <FileRow key={file.id} applicationId={application.id} file={fileItem(file)} canDelete showDownload />
            ))}
          </ul>
        </AdminCard>
      ) : null}

      <AdminCard aria-labelledby="new-document" className="gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="new-document" className="text-lg font-extrabold tracking-[-0.02em]">
            Müşteriden yeni belge iste
          </h2>
          <p className="text-[13px] text-dash-ink-2">Standart listede olmayan bir belge veya imzalanacak bir evrak için.</p>
        </div>
        <DocumentRequestForm applicationId={application.id} maxBytes={maxUploadBytes()} />
      </AdminCard>
    </div>
  );
}

function CommunicationTab({ detail }: { detail: StaffApplicationDetail }) {
  const list = (items: StaffApplicationDetail["messages"], empty: string) =>
    items.length === 0 ? (
      <p className="text-sm text-dash-ink-3">{empty}</p>
    ) : (
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.id} className="rounded-[16px] bg-dash-subtle px-4 py-3">
            <p className="text-xs text-dash-ink-3">
              {formatDateTimeTr(item.createdAt)}
              {item.authorName ? ` · ${item.authorName}` : ""}
            </p>
            <p className="mt-1 whitespace-pre-line text-[15px] leading-6">{item.body}</p>
          </li>
        ))}
      </ul>
    );
  return (
    <div className="grid items-start gap-4 min-[1000px]:grid-cols-2">
      <AdminCard aria-labelledby="messages" className="gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="messages" className="text-lg font-extrabold tracking-[-0.02em]">
            Müşteriye görünen mesajlar
          </h2>
          <p className="text-[13px] text-dash-ink-2">Müşteri bu mesajları kendi panelinde okur ve bildirim alır.</p>
        </div>
        <MessageComposer applicationId={detail.application.id} />
        <div className="border-t border-dash-line-soft pt-4">{list(detail.messages, "Henüz mesaj gönderilmedi.")}</div>
      </AdminCard>
      <AdminCard aria-labelledby="internal-notes" className="gap-4 border-dash-yellow-border">
        <div className="flex flex-col gap-1">
          <h2 id="internal-notes" className="text-lg font-extrabold tracking-[-0.02em]">
            İç notlar
          </h2>
          <p className="text-[13px] text-dash-ink-2">Yalnızca personel görür. Müşteriye gösterilmez.</p>
        </div>
        <NoteComposer applicationId={detail.application.id} />
        <div className="border-t border-dash-line-soft pt-4">{list(detail.notes, "Henüz iç not yok.")}</div>
      </AdminCard>
    </div>
  );
}

function HistoryTab({ detail }: { detail: StaffApplicationDetail }) {
  if (detail.audit.length === 0) return <p className="text-sm text-dash-ink-2">Bu başvuru için kayıtlı işlem yok.</p>;
  const actors = auditActorTexts(detail.audit);
  return (
    <div className="overflow-x-auto rounded-[22px] border border-dash-line bg-white">
      <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
        <caption className="sr-only">İşlem geçmişi</caption>
        <thead>
          <tr className="border-b border-dash-line-soft text-xs font-bold tracking-[0.06em] text-dash-ink-3">
            {["ZAMAN", "İŞLEM", "AYRINTI", "YAPAN"].map((heading) => (
              <th key={heading} scope="col" className="px-6 py-3.5 font-bold">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {detail.audit.map((entry) => (
            <tr key={entry.id} className="border-b border-dash-line-faint align-top last:border-b-0">
              <td className="whitespace-nowrap px-6 py-3 tabular-nums text-dash-ink-3">{formatDateTimeTr(entry.createdAt)}</td>
              <td className="px-6 py-3 font-bold">{AUDIT_LABELS[entry.action] ?? entry.action}</td>
              <td className="px-6 py-3">{auditDetail(entry)}</td>
              <td className="px-6 py-3 text-dash-ink-2">
                {entry.actorName && entry.actorIsStaff ? (
                  <span className="font-semibold text-dash-navy">{staffActorText(entry.actorName)}</span>
                ) : (
                  (actors.get(entry.id) ?? "Otomatik")
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Page ---------------------------------------------------------------------------------------------------------------

/** The tab comes from the "tab" value in the address; unknown values count as "Genel". */
export function detailTab(value: unknown): TabId {
  return TABS.some((t) => t.id === value) ? (value as TabId) : "general";
}

export function ApplicationDetailView({ detail, tab }: { detail: StaffApplicationDetail; tab: TabId }) {
  const { application } = detail;
  const personal = detail.formData.personal ?? {};
  const applicant = `${str(personal.firstName)} ${str(personal.lastName)}`.trim();
  const key = adminStateKey(application);
  const [pillLabel, pillTone] = ADMIN_STATES[key].pill;
  const subtitle = [
    application.referenceCode,
    ...application.applicationTypes.map((t) => APPLICATION_TYPE_LABELS[t]),
    detail.cityName,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-2.5">
        <div className="mr-auto flex min-w-0 flex-col gap-2">
          <p className="text-[13px] text-dash-ink-3">
            <Link href={ROUTES.staff} className="font-semibold no-underline">
              ← Başvurular
            </Link>{" "}
            / {application.referenceCode}
          </p>
          <div className="flex flex-wrap items-center gap-3.5">
            <h1 className="text-[30px] font-extrabold tracking-[-0.02em]">{applicant || detail.customer.name}</h1>
            <AdminPill tone={pillTone}>{pillLabel}</AdminPill>
          </div>
          <p className="text-sm text-dash-ink-2">{subtitle.join(" · ")}</p>
        </div>
        <a href={`/api/admin/applications/${application.id}/form-pdf`} className={adminButton("secondary", "md")}>
          <FileText aria-hidden className="size-4" strokeWidth={2.5} />
          Form PDF
        </a>
        <ExportButton applicationId={application.id} buttonClassName={adminButton("primary", "md")} label="Tüm evraklar (ZIP)" floating />
      </div>

      <nav aria-label="Başvuru bölümleri" className="flex gap-6 overflow-x-auto overflow-y-hidden border-b border-dash-line [scrollbar-width:none]">
        {TABS.map((item) => (
          <Link
            key={item.id}
            href={staffApplicationPath(application.id, item.id === "general" ? undefined : item.id)}
            aria-current={item.id === tab ? "page" : undefined}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-0.5 py-2.5 text-sm no-underline",
              item.id === tab ? "border-dash-navy font-bold text-dash-navy hover:text-dash-navy" : "border-transparent font-semibold text-dash-ink-2 hover:text-dash-navy",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {tab === "general" ? <GeneralTab detail={detail} /> : null}
      {tab === "form" ? <FormTab detail={detail} /> : null}
      {tab === "documents" ? <DocumentsTab detail={detail} /> : null}
      {tab === "messages" ? <CommunicationTab detail={detail} /> : null}
      {tab === "history" ? <HistoryTab detail={detail} /> : null}
    </div>
  );
}

