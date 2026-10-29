"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canCancelApplication,
  canManageAppointment,
  canMarkDocumentsComplete,
  canReopenApplication,
  canUndoDocumentsComplete,
  outstandingCustomerActions,
  type RuleResult,
} from "@/features/applications/status-flow";
import { canStaffReviewPayment, canStaffSetVisaOutcome, type PaymentDecision } from "@/features/applications/submission";
import { CANCEL_REASON_PREFIX } from "@/features/staff/admin-detail";
import { canDeleteApplication } from "@/features/staff/application-deletion";
import { adminStateKey } from "@/features/staff/admin-state";
import { APPLICATION_STATUS_LABELS, isVisaOutcome, STORAGE_BUCKET, toApplicationStatus, type ApplicationStatus } from "@/lib/domain/constants";
import { customerApplicationPath, ROUTES, staffApplicationPath } from "@/lib/site";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { formatDateTimeTr, todayInIstanbul } from "@/lib/validation/formats";
import { getCurrentUser, isActiveStaff, staffAccessError, type CurrentUser } from "../auth";
import { scheduleEmailDelivery } from "../email/deliver";
import { fetchApplication, fetchAppointmentLetter, fetchDocumentSlots, fetchTasks, fetchVisaOutcome } from "../data/queries";
import type { Application } from "../data/types";
import { logError, logWarning } from "../log";
import {
  ADMIN_REQUIRED_ERROR,
  fail,
  FORBIDDEN_ERROR,
  GENERIC_ERROR,
  isUuid,
  NOT_CONFIGURED_ERROR,
  NOT_FOUND_ERROR,
  ok,
  SESSION_EXPIRED_ERROR,
  type ActionResult,
} from "../result";

/**
 * STAFF ACTIONS (application management)
 *
 * Writes use the staff member's OWN session; permission is verified again in the database on every query
 * (RLS: private.is_staff()) and status changes are recorded in the audit log by triggers.
 * The role check here is an extra layer, not the only defense.
 */

type StaffContext = { user: CurrentUser; supabase: SupabaseClient };

async function getStaff(): Promise<StaffContext | { error: string }> {
  if (!isSupabaseConfigured()) return { error: NOT_CONFIGURED_ERROR };
  const user = await getCurrentUser();
  if (!user) return { error: SESSION_EXPIRED_ERROR };
  if (!isActiveStaff(user)) return { error: staffAccessError(user) ?? FORBIDDEN_ERROR };
  return { user, supabase: await createClient() };
}

async function loadApplication(ctx: StaffContext, applicationId: string): Promise<Application | null> {
  if (!isUuid(applicationId)) return null;
  return fetchApplication(ctx.supabase, applicationId);
}

function revalidate(applicationId: string): void {
  revalidatePath(staffApplicationPath(applicationId));
  revalidatePath("/admin");
  revalidatePath(customerApplicationPath(applicationId), "layout");
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim().slice(0, max) : "";
}

/**
 * Creates an in-app notification for the customer; if SMTP is configured the same notification also goes out as an e-mail
 * after the response is sent (src/server/email). The notification is not part of the main action: if it cannot be created
 * the action is not rolled back, but staff are told.
 */
async function notifyCustomer(
  ctx: StaffContext,
  application: Application,
  kind: string,
  title: string,
  body: string,
): Promise<boolean> {
  const { error } = await ctx.supabase.from("notifications").insert({
    user_id: application.customerId,
    application_id: application.id,
    kind,
    title: title.slice(0, 200),
    body: body.slice(0, 1000),
  });
  if (error) {
    logError("notification.create", error);
    return false;
  }
  scheduleEmailDelivery();
  return true;
}

function done(message: string, notified: boolean): ActionResult {
  return ok(notified ? message : `${message} Ancak müşteriye bildirim oluşturulamadı; lütfen müşteriyi ayrıca bilgilendiriniz.`);
}

// --- Status -----------------------------------------------------------------
//
// The application status follows automatically from what has been done (database migration 12; rule:
// src/features/applications/status-flow.ts). The only transitions staff make by hand are:
// "Evraklar tamamlandı" and undoing it, cancelling and undoing the cancellation. A database trigger applies the same rules.

export type StageAction = "documents_complete" | "undo_documents_complete" | "cancel" | "reopen";

const STAGE_TARGET: Record<StageAction, ApplicationStatus> = {
  documents_complete: "documents_complete",
  undo_documents_complete: "in_review",
  cancel: "cancelled",
  // When a cancellation is undone the database restores the stage before cancellation (migration 13), then applies the automatic rule.
  reopen: "submitted",
};

const STAGE_DONE: Record<StageAction, string> = {
  documents_complete: "Evraklar tamamlandı olarak işaretlendi.",
  undo_documents_complete: "“Evraklar tamamlandı” işareti kaldırıldı; başvuru yeniden inceleme aşamasında.",
  cancel: "Başvuru iptal edildi.",
  reopen: "İptal geri alındı; başvuru önceki aşamasına döndü.",
};

/** Reads the status set by the database trigger (the row returned by the update is the state before the trigger). */
async function currentStatus(ctx: StaffContext, applicationId: string): Promise<ApplicationStatus | null> {
  const { data, error } = await ctx.supabase.from("applications").select("status").eq("id", applicationId).maybeSingle();
  if (error) {
    logError("staff.read_status", error);
    return null;
  }
  return toApplicationStatus(data?.status);
}

function statusWriteError(operation: string, error: { code?: string; message?: string }): string {
  const message = error.message ?? "";
  if (message.includes("payment_not_verified")) return "Ödeme doğrulanmadan başvuru bu aşamaya alınamaz.";
  if (message.includes("customer_action_outstanding")) return "Müşteriden beklenen işler tamamlanmadan evraklar tamamlandı olarak işaretlenemez.";
  if (message.includes("status_change_not_allowed")) return "Bu işlem başvurunun şu anki aşamasında yapılamaz. Sayfayı yenileyip tekrar deneyiniz.";
  logError(operation, error);
  return GENERIC_ERROR;
}

export async function setApplicationStageAction(applicationId: string, action: StageAction): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  if (typeof action !== "string" || !Object.hasOwn(STAGE_TARGET, action)) return fail("Geçersiz işlem.");
  const application = await loadApplication(ctx, applicationId);
  if (!application) return fail(NOT_FOUND_ERROR);

  let rule: RuleResult;
  if (action === "documents_complete") {
    const [slots, tasks] = await Promise.all([fetchDocumentSlots(ctx.supabase, applicationId), fetchTasks(ctx.supabase, applicationId)]);
    const outstanding = outstandingCustomerActions({
      status: application.status,
      formLocked: application.formLocked,
      slots: slots.map((slot) => ({ ...slot, fileCount: slot.files.length })),
      tasks,
    });
    rule = canMarkDocumentsComplete(application.status, outstanding);
  } else if (action === "undo_documents_complete") rule = canUndoDocumentsComplete(application.status);
  else if (action === "cancel") rule = canCancelApplication(application.status);
  else rule = canReopenApplication(application.status);
  if (!rule.ok) return fail(rule.message);

  const { data, error } = await ctx.supabase.from("applications").update({ status: STAGE_TARGET[action] }).eq("id", applicationId).select("id");
  if (error) return fail(statusWriteError("staff.set_stage", error));
  if (!data || data.length === 0) return fail(FORBIDDEN_ERROR);

  const status = (await currentStatus(ctx, applicationId)) ?? STAGE_TARGET[action];
  // "Evraklar tamamlandı" is sent to the customer with its own text.
  const notified =
    action === "documents_complete" && status === "documents_complete"
      ? await notifyCustomer(
          ctx,
          application,
          "application.documents_reviewed",
          "Evraklarınızın incelenmesi tamamlandı",
          "Evraklarınız incelendi. Randevunuz ayarlandığında tarih, saat ve yer bilgisi size bildirilecektir.",
        )
      : await notifyCustomer(ctx, application, "application.status", "Başvurunuzun durumu güncellendi", `Yeni durum: ${APPLICATION_STATUS_LABELS[status]}`);
  revalidate(applicationId);
  return done(STAGE_DONE[action], notified);
}

/**
 * Cancels the application with a reason (design: "Başvuruyu iptal et", reason required). The reason is only written to the
 * internal notes visible to staff; the customer gets an "İptal edildi" (cancelled) status notification. The cancellation can be undone later.
 */
export async function cancelApplicationAction(applicationId: string, reason: string): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  const text = clean(reason, 1000);
  if (text === "") return fail("İptal gerekçesini yazınız.", { reason: "İptal gerekçesini yazınız." });
  const application = await loadApplication(ctx, applicationId);
  if (!application) return fail(NOT_FOUND_ERROR);
  const rule = canCancelApplication(application.status);
  if (!rule.ok) return fail(rule.message);

  const { data, error } = await ctx.supabase.from("applications").update({ status: "cancelled" }).eq("id", applicationId).select("id");
  if (error) return fail(statusWriteError("staff.cancel", error));
  if (!data || data.length === 0) return fail(FORBIDDEN_ERROR);

  const { error: noteError } = await ctx.supabase
    .from("staff_notes")
    .insert({ application_id: applicationId, author_id: ctx.user.id, body: `${CANCEL_REASON_PREFIX}${text}` });
  if (noteError) logError("staff.cancel.note", noteError);
  const notified = await notifyCustomer(ctx, application, "application.status", "Başvurunuzun durumu güncellendi", `Yeni durum: ${APPLICATION_STATUS_LABELS.cancelled}`);
  revalidate(applicationId);
  if (noteError) return ok("Başvuru iptal edildi. Ancak gerekçe iç notlara kaydedilemedi; lütfen İç notlar bölümüne ayrıca yazınız.");
  return done(STAGE_DONE.cancel, notified);
}

type Outstanding = ReturnType<typeof outstandingCustomerActions>;

/** "Müşteriye hatırlat" (remind customer): notification text reminding the customer of what is expected when it is their turn. */
function reminderBody(application: Application, outstanding: Outstanding | null): string | null {
  switch (adminStateKey(application)) {
    case "draft":
      return "Başvuru formunuzu tamamlayıp göndermeniz bekleniyor.";
    case "awaitingPayment":
      return "Ödemenizi yapıp panelinizden “Ödemeyi yaptım” ile bildirmeniz bekleniyor. Banka bilgileri başvurunuzda yer alır.";
    case "payRejected":
      return "Ödemeniz doğrulanamadı. Başvurunuzdaki açıklamayı okuyup yeni dekont yüklemeniz bekleniyor.";
    case "c": {
      if (!outstanding?.any) return "Başvurunuzda sizden beklenen işlemler var.";
      const parts: string[] = [];
      if (outstanding.documents > 0) parts.push(`${outstanding.documents} belgeyi yüklemeniz`);
      if (outstanding.tasks > 0) parts.push(`${outstanding.tasks} görevi tamamlamanız`);
      if (outstanding.form) parts.push("başvuru formunuzu düzeltmeniz");
      const list = parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} ve ${parts.at(-1)}`;
      return `Başvurunuzda ${list} bekleniyor.`;
    }
    default:
      return null;
  }
}

export async function remindCustomerAction(applicationId: string): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  const application = await loadApplication(ctx, applicationId);
  if (!application) return fail(NOT_FOUND_ERROR);

  let outstanding: Outstanding | null = null;
  if (application.status === "awaiting_customer") {
    const [slots, tasks] = await Promise.all([fetchDocumentSlots(ctx.supabase, applicationId), fetchTasks(ctx.supabase, applicationId)]);
    outstanding = outstandingCustomerActions({
      status: application.status,
      formLocked: application.formLocked,
      slots: slots.map((slot) => ({ ...slot, fileCount: slot.files.length })),
      tasks,
    });
  }
  const body = reminderBody(application, outstanding);
  if (!body) return fail("Bu aşamada müşteriden beklenen bir işlem yok; hatırlatma gönderilmedi.");

  const notified = await notifyCustomer(ctx, application, "application.reminder", "Başvurunuzda sizden bir işlem bekleniyor", body);
  if (!notified) return fail("Hatırlatma gönderilemedi. Lütfen tekrar deneyiniz.");
  // "Son hatırlatma" (last reminder) is read from this entry in the audit log (migration 14). If the entry cannot be written the reminder has still been sent.
  const { error } = await ctx.supabase.rpc("record_staff_event", {
    p_action: "customer.reminded",
    p_application_id: applicationId,
    p_details: { state: adminStateKey(application) },
  });
  if (error) logWarning("staff.remind.audit", { code: String(error.code ?? "") });
  revalidate(applicationId);
  return ok("Hatırlatma müşteriye gönderildi.");
}

/** `documentNotes`: per-document notes (document id → note); the general note (`note`) is used for documents without one. */
export type CorrectionRequestInput = { documentIds: string[]; documentNotes?: Record<string, string>; openForm: boolean; note: string };

/**
 * "Ek evrak / düzeltme iste" (request extra document / correction; the dialog in the design): the selected documents are
 * requested again ("missing" if there is no file, otherwise "correction needed"), optionally the form is opened for the
 * customer to edit; the customer gets a single notification. The application moves to "Müşteriden işlem bekleniyor" by
 * itself (database rule).
 */
export async function requestCorrectionsAction(applicationId: string, input: CorrectionRequestInput): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  const application = await loadApplication(ctx, applicationId);
  if (!application) return fail(NOT_FOUND_ERROR);
  if (application.status === "draft") return fail("Taslak başvuruda düzeltme istenmez; müşteri başvuruyu gönderdiğinde isteyebilirsiniz.");
  if (application.status === "cancelled" || application.status === "result_communicated") return fail("Kapanmış başvuruda düzeltme istenemez.");

  // Server action arguments are untrusted.
  const raw: Partial<Record<keyof CorrectionRequestInput, unknown>> = typeof input === "object" && input !== null ? input : {};
  const ids = Array.isArray(raw.documentIds) ? [...new Set(raw.documentIds.filter(isUuid))].slice(0, 100) : [];
  const openForm = raw.openForm === true;
  const note = clean(raw.note, 1000);
  const rawNotes = typeof raw.documentNotes === "object" && raw.documentNotes !== null ? (raw.documentNotes as Record<string, unknown>) : {};
  const noteOf = (id: string) => clean(Object.hasOwn(rawNotes, id) ? rawNotes[id] : "", 1000);
  if (ids.length === 0 && !openForm) return fail("En az bir belge seçiniz veya formu düzenlemeye açınız.");

  const slots = ids.length > 0 ? await fetchDocumentSlots(ctx.supabase, applicationId) : [];
  const selected = slots.filter((slot) => ids.includes(slot.id) && !slot.outOfScope);
  if (selected.length !== ids.length) return fail("Seçilen belgelerden biri bu başvuruda bulunamadı. Sayfayı yenileyip tekrar deneyiniz.");

  for (const slot of selected) {
    const { error } = await ctx.supabase
      .from("application_documents")
      .update({ review_status: slot.files.length === 0 ? "missing" : "needs_correction", review_note: noteOf(slot.id) || note || "Danışmanınız bu belgeyi yeniden istedi." })
      .eq("id", slot.id)
      .eq("application_id", applicationId);
    if (error) {
      logError("staff.request_corrections.document", error);
      return fail(GENERIC_ERROR);
    }
  }
  if (openForm && application.formLocked) {
    const { error } = await ctx.supabase.from("applications").update({ form_locked: false }).eq("id", applicationId);
    if (error) {
      logError("staff.request_corrections.form", error);
      return fail(selected.length > 0 ? "Belgeler istendi ancak form düzenlemeye açılamadı. Lütfen tekrar deneyiniz." : GENERIC_ERROR);
    }
  }

  // Sections are separate paragraphs. The document list is line by line.
  const paragraphs = [
    ...(selected.length > 0
      ? [["Yeniden istenen belgeler:", ...selected.map((slot) => (noteOf(slot.id) ? `• ${slot.label}: ${noteOf(slot.id)}` : `• ${slot.label}`))].join("\n")]
      : []),
    ...(openForm ? ["Başvuru formunuz düzenlemeniz için açıldı. Düzeltmeleri yaptıktan sonra “Formu düzenlemeyi tamamladım” düğmesine basınız."] : []),
    ...(note ? [`Danışmanınızın notu:\n${note}`] : []),
  ];
  const notified = await notifyCustomer(
    ctx,
    application,
    selected.length > 0 ? "document.action_required" : "form.unlocked",
    selected.length > 0 ? "Başvurunuzda düzeltme bekleniyor" : "Başvuru formunuzda düzeltme bekleniyor",
    paragraphs.join("\n\n"),
  );
  revalidate(applicationId);
  return done("Müşteriden istendi; başvuru “Müşteriden işlem bekleniyor” aşamasına geçti.", notified);
}

/**
 * Opens or closes the form for the customer to edit. When opened, if the customer has a pending form edit request the
 * database closes it by itself (migration 17); when the customer finishes the correction they say "Formu düzenlemeyi tamamladım".
 */
export async function setFormLockAction(applicationId: string, locked: boolean): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  const application = await loadApplication(ctx, applicationId);
  if (!application) return fail(NOT_FOUND_ERROR);
  if (application.status === "draft") return fail("Taslak başvurunun formu zaten müşteri tarafından düzenlenebilir.");

  const { data, error } = await ctx.supabase.from("applications").update({ form_locked: locked === true }).eq("id", applicationId).select("id");
  if (error) {
    logError("staff.set_form_lock", error);
    return fail(GENERIC_ERROR);
  }
  if (!data || data.length === 0) return fail(FORBIDDEN_ERROR);

  // The customer is notified both when it is opened and when it is closed (design: "Kapatınca müşteriye bildirim gider").
  const notified = locked
    ? await notifyCustomer(
        ctx,
        application,
        "form.locked",
        "Başvuru formunuz düzenlemeye kapatıldı",
        "Danışmanınız başvuru formunuzu düzenlemeye kapattı. Yaptığınız düzeltmeler danışmanınıza iletildi.",
      )
    : await notifyCustomer(
        ctx,
        application,
        "form.unlocked",
        application.formEditRequestedAt ? "Form düzenleme isteğiniz kabul edildi" : "Başvuru formunuzda düzeltme bekleniyor",
        "Danışmanınız başvuru formunuzu düzenlemeniz için açtı. Düzeltmeleri yaptıktan sonra “Formu düzenlemeyi tamamladım” düğmesine basınız.",
      );
  revalidate(applicationId);
  return done(locked ? "Form müşteri düzenlemesine kapatıldı." : "Form müşteri düzenlemesine açıldı.", notified);
}

/**
 * Refuses the customer's form edit request: the request is closed, the form stays locked and
 * the customer is notified. The reason is optional; if written it appears in the notification. To accept,
 * opening the form for editing is enough.
 */
export async function declineFormEditRequestAction(applicationId: string, reason: unknown): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  const application = await loadApplication(ctx, applicationId);
  if (!application) return fail(NOT_FOUND_ERROR);
  if (!application.formEditRequestedAt) return fail("Bekleyen bir form düzenleme isteği yok. Sayfayı yenileyiniz.");
  const text = clean(reason, 1000);

  const { data, error } = await ctx.supabase
    .from("applications")
    .update({ form_edit_requested_at: null, form_edit_request_note: null })
    .eq("id", applicationId)
    .not("form_edit_requested_at", "is", null)
    .select("id");
  if (error) {
    logError("staff.decline_form_edit", error);
    return fail(GENERIC_ERROR);
  }
  if (!data || data.length === 0) return fail("İstek bu arada yanıtlanmış. Sayfayı yenileyiniz.");

  const { error: auditError } = await ctx.supabase.rpc("record_staff_event", {
    p_action: "customer.form_edit_declined",
    p_application_id: applicationId,
    p_details: {},
  });
  if (auditError) logWarning("staff.decline_form_edit.audit", { code: String(auditError.code ?? "") });
  const notified = await notifyCustomer(
    ctx,
    application,
    "form.edit_declined",
    "Form düzenleme isteğiniz kabul edilmedi",
    text || "Danışmanınız formunuzda değişiklik yapılmasını gerekli görmedi; formunuz gönderdiğiniz hâliyle kalacak.",
  );
  revalidate(applicationId);
  return done(text ? "İstek reddedildi; müşteriye gerekçeyle bildirildi." : "İstek reddedildi; müşteriye bildirildi.", notified);
}

// --- Payment ----------------------------------------------------------------

export async function reviewPaymentAction(applicationId: string, decision: PaymentDecision, note: string): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  const application = await loadApplication(ctx, applicationId);
  if (!application) return fail(NOT_FOUND_ERROR);
  if (decision !== "verify" && decision !== "reject") return fail("Geçersiz işlem.");

  const cleanNote = clean(note, 1000);
  const rule = canStaffReviewPayment(application.status, application.paymentStatus, decision, cleanNote);
  if (!rule.ok) return fail(rule.message);

  // Who verified and when is NOT TAKEN from the client; a database trigger stamps it.
  const { data, error } = await ctx.supabase
    .from("applications")
    .update({ payment_status: decision === "verify" ? "verified" : "rejected", payment_note: decision === "reject" ? cleanNote : null })
    .eq("id", applicationId)
    .select("id");
  if (error) {
    if (error.message?.includes("payment_not_verified")) {
      return fail("Ödeme doğrulandığı için başvuru inceleme aşamasına geçti; doğrulama geri alınamaz.");
    }
    logError("staff.review_payment", error);
    return fail(GENERIC_ERROR);
  }
  if (!data || data.length === 0) return fail(FORBIDDEN_ERROR);

  // On verification the detail is a full sentence; on refusal it is the consultant's explanation (shown in the "Açıklama" box in the e-mail).
  const notified = await notifyCustomer(
    ctx,
    application,
    decision === "verify" ? "payment.verified" : "payment.rejected",
    decision === "verify" ? "Ödemeniz doğrulandı" : "Ödemeniz doğrulanamadı",
    decision === "verify" ? "Ödemeniz danışmanlarımız tarafından doğrulandı. Başvurunuzun incelenmesine başlanacak." : cleanNote,
  );
  revalidate(applicationId);
  if (decision === "verify") {
    // A verified payment moves the application to review in the database by itself (or to the customer stage if something is expected from them).
    const status = await currentStatus(ctx, applicationId);
    const stage = status && status !== "submitted" ? ` Başvuru “${APPLICATION_STATUS_LABELS[status]}” aşamasına geçti.` : "";
    return done(`Ödeme doğrulandı.${stage}`, notified);
  }
  return done("Ödeme doğrulanamadı olarak işaretlendi.", notified);
}

// --- Appointment ------------------------------------------------------------

//
// The consultant does not pick an appointment status: "Randevu tarihini bildir" (date, time,
// location from the list in Settings, optional note) and "Yeni tercih iste". Once the date has passed a scheduled job sets the
// appointment to "Randevu gerçekleşti" (supabase/cron/complete-past-appointments.sql).

export type ScheduleAppointmentInput = {
  /** "YYYY-MM-DDTHH:mm" (Istanbul time). */
  localDateTime: string;
  locationId: string;
  note: string;
  /** Was a new appointment letter uploaded with this action? Verified on the server by the letter's existence. */
  letterUploaded?: boolean;
};

const LOCATIONS_MISSING = "Randevu yerleri için veritabanı güncellemesi (12. dosya) henüz çalıştırılmadı.";
const isMissingRelation = (code: string | undefined) => code === "42P01" || code === "PGRST205";
const isMissingColumn = (code: string | undefined) => code === "42703" || code === "PGRST204";

/** Converts Istanbul local time (UTC+3, no daylight saving) to an ISO timestamp. */
function istanbulToIso(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const date = new Date(`${local}:00+03:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function scheduleAppointmentAction(applicationId: string, input: ScheduleAppointmentInput): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  const application = await loadApplication(ctx, applicationId);
  if (!application) return fail(NOT_FOUND_ERROR);
  const rule = canManageAppointment(application.status);
  if (!rule.ok) return fail(rule.message);

  // Server action arguments are untrusted.
  const raw: Partial<Record<keyof ScheduleAppointmentInput, unknown>> = typeof input === "object" && input !== null ? input : {};
  const local = clean(raw.localDateTime, 16);
  const appointmentAt = istanbulToIso(local);
  if (!appointmentAt) return fail("Randevu tarihini ve saatini giriniz.", { localDateTime: "Randevu tarihini ve saatini giriniz." });
  if (local.slice(0, 10) < todayInIstanbul()) {
    return fail("Randevu tarihi geçmiş bir gün olamaz.", { localDateTime: "Randevu tarihi geçmiş bir gün olamaz." });
  }
  if (!isUuid(raw.locationId)) return fail("Randevu yerini seçiniz.", { locationId: "Randevu yerini seçiniz." });
  const note = clean(raw.note, 1000);

  // The map link came with migration 17; without it the location is read without a link.
  let { data: location, error: locationError } = await ctx.supabase
    .from("appointment_locations")
    .select("id, name, address, is_active, maps_url")
    .eq("id", raw.locationId)
    .maybeSingle();
  if (isMissingColumn(locationError?.code)) {
    ({ data: location, error: locationError } = await ctx.supabase.from("appointment_locations").select("id, name, address, is_active").eq("id", raw.locationId).maybeSingle());
  }
  if (locationError) {
    if (isMissingRelation(locationError.code)) return fail(LOCATIONS_MISSING);
    logError("staff.schedule_appointment.location", locationError);
    return fail(GENERIC_ERROR);
  }
  if (!location || location.is_active !== true) {
    return fail("Seçilen randevu yeri bulunamadı veya kullanım dışı. Listeden yeniden seçiniz.", { locationId: "Randevu yerini yeniden seçiniz." });
  }
  const locationName = String(location.name);
  const mapsUrl = typeof (location as { maps_url?: unknown }).maps_url === "string" ? ((location as { maps_url: string }).maps_url) : null;

  const values = {
    appointment_status: "scheduled",
    appointment_at: appointmentAt,
    appointment_location: locationName,
    appointment_address: String(location.address),
    appointment_location_id: String(location.id),
    appointment_note: note || null,
  };
  let { data, error } = await ctx.supabase
    .from("applications")
    .update({ ...values, appointment_maps_url: mapsUrl })
    .eq("id", applicationId)
    .select("id");
  // Without migration 17 there is no map link column; the appointment is saved without a link.
  if (isMissingColumn(error?.code)) ({ data, error } = await ctx.supabase.from("applications").update(values).eq("id", applicationId).select("id"));
  if (error) {
    if (isMissingColumn(error.code)) return fail(LOCATIONS_MISSING);
    logError("staff.schedule_appointment", error);
    return fail(GENERIC_ERROR);
  }
  if (!data || data.length === 0) return fail(FORBIDDEN_ERROR);

  // The appointment letter (migration 25) is uploaded separately; the client's "uploaded" flag is verified by the letter actually existing.
  // A read error is logged (check); since the appointment was saved the action does not fail because of it, the notification just doesn't mention the letter.
  const letter = raw.letterUploaded === true ? await fetchAppointmentLetter(ctx.supabase, applicationId).catch(() => null) : null;
  const wasScheduled = application.appointmentStatus === "scheduled";
  const changed =
    !wasScheduled ||
    letter !== null ||
    application.appointmentAt !== appointmentAt ||
    application.appointmentLocationId !== location.id ||
    (application.appointmentNote ?? "") !== note;
  // When a sent appointment is edited an "updated" notification goes out.
  const summary = `Randevunuz: ${formatDateTimeTr(appointmentAt)} · ${locationName}${letter ? ". Randevu belgeniz başvuru sayfanıza eklendi." : ""}`;
  const notified = !changed
    ? true
    : wasScheduled
      ? await notifyCustomer(ctx, application, "appointment.updated", "Randevu bilgileriniz güncellendi", `Randevu bilgileriniz danışmanınız tarafından güncellendi. ${summary}`)
      : await notifyCustomer(ctx, application, "appointment.scheduled", "Randevu tarihiniz bildirildi", summary);
  revalidate(applicationId);
  return done(wasScheduled ? "Randevu bilgileri güncellendi." : "Randevu tarihi müşteriye bildirildi.", notified);
}

/** Asks the customer for new appointment preferences; a sent appointment becomes invalid and its details are deleted. */
export async function requestNewPreferencesAction(applicationId: string): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  const application = await loadApplication(ctx, applicationId);
  if (!application) return fail(NOT_FOUND_ERROR);
  const rule = canManageAppointment(application.status);
  if (!rule.ok) return fail(rule.message);
  if (application.appointmentStatus === "preferences_requested") return fail("Müşteriden zaten yeni tercih bekleniyor.");

  const cleared = { appointment_status: "preferences_requested", appointment_at: null, appointment_location: null, appointment_note: null };
  let { data, error } = await ctx.supabase
    .from("applications")
    .update({ ...cleared, appointment_address: null, appointment_location_id: null, appointment_maps_url: null })
    .eq("id", applicationId)
    .select("id");
  // Without migration 12 or 17 the location columns do not exist.
  if (isMissingColumn(error?.code)) {
    ({ data, error } = await ctx.supabase
      .from("applications")
      .update({ ...cleared, appointment_address: null, appointment_location_id: null })
      .eq("id", applicationId)
      .select("id"));
  }
  if (isMissingColumn(error?.code)) ({ data, error } = await ctx.supabase.from("applications").update(cleared).eq("id", applicationId).select("id"));
  if (error) {
    logError("staff.request_preferences", error);
    return fail(GENERIC_ERROR);
  }
  if (!data || data.length === 0) return fail(FORBIDDEN_ERROR);

  const notified = await notifyCustomer(
    ctx,
    application,
    "appointment.preferences_requested",
    "Yeni randevu tercihi bekleniyor",
    "Danışmanınız sizden yeni randevu tercihleri bildirmenizi istedi.",
  );
  revalidate(applicationId);
  return done("Müşteriden yeni randevu tercihi istendi.", notified);
}

/**
 * Withdraws a sent appointment: date, time, location and note are deleted; the customer's
 * preferences stay and no new preferences are requested. The application waits for a new date in the "Evraklar tamamlandı" stage.
 */
export async function withdrawAppointmentAction(applicationId: string): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  const application = await loadApplication(ctx, applicationId);
  if (!application) return fail(NOT_FOUND_ERROR);
  const rule = canManageAppointment(application.status);
  if (!rule.ok) return fail(rule.message);
  if (application.appointmentStatus !== "scheduled") return fail("Geri çekilecek bildirilmiş bir randevu yok.");

  const { count, error: countError } = await ctx.supabase
    .from("appointment_preferences")
    .select("application_id", { count: "exact", head: true })
    .eq("application_id", applicationId);
  if (countError) {
    logError("staff.withdraw_appointment.preferences", countError);
    return fail(GENERIC_ERROR);
  }
  const withdrawn = {
    appointment_status: (count ?? 0) > 0 ? "preferences_submitted" : "not_started",
    appointment_at: null,
    appointment_location: null,
    appointment_address: null,
    appointment_location_id: null,
    appointment_note: null,
  };
  const withdraw = (values: Record<string, unknown>) =>
    ctx.supabase.from("applications").update(values).eq("id", applicationId).eq("appointment_status", "scheduled").select("id");
  let { data, error } = await withdraw({ ...withdrawn, appointment_maps_url: null });
  // Without migration 17 there is no map link column.
  if (isMissingColumn(error?.code)) ({ data, error } = await withdraw(withdrawn));
  if (error) {
    logError("staff.withdraw_appointment", error);
    return fail(GENERIC_ERROR);
  }
  if (!data || data.length === 0) return fail("Randevu bu arada değişmiş. Sayfayı yenileyip tekrar deneyiniz.");

  const notified = await notifyCustomer(
    ctx,
    application,
    "appointment.withdrawn",
    "Randevunuz geri çekildi",
    "Danışmanınız daha önce bildirilen randevuyu geri çekti. Yeni randevu bilgisi bildirildiğinde size haber verilecektir.",
  );
  revalidate(applicationId);
  return done("Randevu geri çekildi; başvuru yeni randevu tarihini bekliyor.", notified);
}

// --- Documents --------------------------------------------------------------

// Two buttons instead of a review list: "Uygun" (approved) and "Sorun bildir" (report a problem).
// The customer can upload a document with a reported problem again (database trigger), the customer is notified and
// the application becomes "Müşteriden işlem bekleniyor" by itself.

async function readSlot(ctx: StaffContext, applicationId: string, documentId: string): Promise<{ label: string; fileCount: number } | null> {
  const [slotResult, filesResult] = await Promise.all([
    ctx.supabase.from("application_documents").select("id, custom_label, document_types(label)").eq("id", documentId).eq("application_id", applicationId).maybeSingle(),
    ctx.supabase
      .from("application_files")
      .select("id", { count: "exact", head: true })
      .eq("application_document_id", documentId)
      .eq("kind", "document")
      .eq("status", "ready"),
  ]);
  const error = slotResult.error ?? filesResult.error;
  if (error) {
    logError("staff.review_document.read", error);
    return null;
  }
  if (!slotResult.data) return null;
  const row = slotResult.data as { custom_label?: string | null; document_types?: { label?: string } | null };
  return { label: row.custom_label ?? row.document_types?.label ?? "Belge", fileCount: filesResult.count ?? 0 };
}

export async function approveDocumentAction(applicationId: string, documentId: string): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  const application = await loadApplication(ctx, applicationId);
  if (!application || !isUuid(documentId)) return fail(NOT_FOUND_ERROR);
  if (application.status === "draft") return fail("Taslak başvuruda belge incelenmez; müşteri başvuruyu gönderdiğinde inceleyebilirsiniz.");

  const { data, error } = await ctx.supabase
    .from("application_documents")
    .update({ review_status: "approved", review_note: null })
    .eq("id", documentId)
    .eq("application_id", applicationId)
    .select("id");
  if (error) {
    logError("staff.approve_document", error);
    return fail(GENERIC_ERROR);
  }
  if (!data || data.length === 0) return fail(NOT_FOUND_ERROR);
  revalidate(applicationId);
  return ok("Belge uygun olarak işaretlendi.");
}

export async function reportDocumentProblemAction(applicationId: string, documentId: string, note: string): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  const application = await loadApplication(ctx, applicationId);
  if (!application || !isUuid(documentId)) return fail(NOT_FOUND_ERROR);
  if (application.status === "draft") return fail("Taslak başvuruda belge incelenmez; müşteri başvuruyu gönderdiğinde inceleyebilirsiniz.");
  const cleanNote = clean(note, 1000);
  if (cleanNote === "") return fail("Müşterinin ne yapması gerektiğini yazınız.", { note: "Müşterinin ne yapması gerektiğini yazınız." });

  const slot = await readSlot(ctx, applicationId, documentId);
  if (!slot) return fail(NOT_FOUND_ERROR);
  // Without a file the document is marked "missing", with one "correction needed".
  const reviewStatus = slot.fileCount === 0 ? "missing" : "needs_correction";

  const { data, error } = await ctx.supabase
    .from("application_documents")
    .update({ review_status: reviewStatus, review_note: cleanNote })
    .eq("id", documentId)
    .eq("application_id", applicationId)
    .select("id");
  if (error) {
    logError("staff.report_document_problem", error);
    return fail(GENERIC_ERROR);
  }
  if (!data || data.length === 0) return fail(NOT_FOUND_ERROR);

  const notified = await notifyCustomer(
    ctx,
    application,
    "document.action_required",
    reviewStatus === "missing" ? "Eksik belge" : "Belgenizde düzeltme gerekiyor",
    `${slot.label}: ${cleanNote}`,
  );
  revalidate(applicationId);
  return done("Sorun müşteriye bildirildi; müşteri bu belgeyi yeniden yükleyebilir.", notified);
}

/** `withAttachment`: the consultant also sends a document for the customer to download and fill in/sign (the file is uploaded afterwards). */
export type DocumentRequestInput = { label: string; description: string; requirement: string; withAttachment?: boolean };

/** Asks the customer for a new document that is not in the standard list. */
export async function requestDocumentAction(applicationId: string, input: DocumentRequestInput): Promise<ActionResult<{ documentId: string }>> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  const application = await loadApplication(ctx, applicationId);
  if (!application) return fail(NOT_FOUND_ERROR);

  const label = clean(input?.label, 160);
  if (label === "") return fail("Belge adını yazınız.", { label: "Belge adını yazınız." });
  const requirement = input?.requirement === "optional" ? "optional" : "required";

  const { data, error } = await ctx.supabase
    .from("application_documents")
    .insert({
      application_id: applicationId,
      custom_label: label,
      custom_description: clean(input?.description, 600) || null,
      requirement,
      reupload_allowed: true,
      requested_by_staff: true,
    })
    .select("id")
    .single();
  if (error || !data) {
    if (error) logError("staff.request_document", error);
    return fail(GENERIC_ERROR);
  }

  // If the consultant also sends a document the notification says so; otherwise it is a new document request.
  const notified =
    input?.withAttachment === true
      ? await notifyCustomer(
          ctx,
          application,
          "document.sent",
          "Danışmanınız size yeni bir belge gönderdi",
          "Kontrol etmeniz/imzalamanız için size yeni bir belge gönderildi. Lütfen belgeyi inceleyip tamamladıktan sonra ilgili kısma yeniden yükleyin.",
        )
      : await notifyCustomer(ctx, application, "document.requested", "Sizden yeni bir belge isteniyor", label);
  revalidate(applicationId);
  const result = done("Belge isteği oluşturuldu.", notified);
  return result.ok ? { ...result, data: { documentId: data.id as string } } : result;
}

/** Removes a custom document request with no uploaded file. */
export async function removeDocumentRequestAction(applicationId: string, documentId: string): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  if (!isUuid(applicationId) || !isUuid(documentId)) return fail(NOT_FOUND_ERROR);
  if (!isAdminClientConfigured()) return fail(NOT_CONFIGURED_ERROR);

  const { data: slot, error: readError } = await ctx.supabase
    .from("application_documents")
    .select("id, document_type_id, attachment_file_id")
    .eq("id", documentId)
    .eq("application_id", applicationId)
    .maybeSingle();
  if (readError) {
    logError("staff.remove_request.read", readError);
    return fail(GENERIC_ERROR);
  }
  if (!slot) return fail(NOT_FOUND_ERROR);
  if (slot.document_type_id !== null) return fail("Standart evrak listesindeki belgeler kaldırılamaz.");

  const { count, error: countError } = await ctx.supabase
    .from("application_files")
    .select("id", { count: "exact", head: true })
    .eq("application_document_id", documentId);
  if (countError) {
    logError("staff.remove_request.count", countError);
    return fail(GENERIC_ERROR);
  }
  if ((count ?? 0) > 0) return fail("Müşteri bu istek için dosya yüklemiş; istek kaldırılamaz.");

  const { error } = await ctx.supabase.from("application_documents").delete().eq("id", documentId).eq("application_id", applicationId);
  if (error) {
    logError("staff.remove_request", error);
    return fail(GENERIC_ERROR);
  }

  // If there is a file the company added, it is deleted too.
  if (typeof slot.attachment_file_id === "string") {
    const admin = createAdminClient();
    const { data: path, error: fileError } = await admin.rpc("svc_delete_file", { p_actor_id: ctx.user.id, p_file_id: slot.attachment_file_id });
    if (fileError) logError("staff.remove_request.attachment", fileError);
    else if (typeof path === "string") {
      const { error: removeError } = await admin.storage.from(STORAGE_BUCKET).remove([path]);
      if (removeError) logWarning("staff.remove_request.orphan_object", { documentId });
    }
  }
  revalidate(applicationId);
  return ok("Belge isteği kaldırıldı.");
}

// --- Messages, notes, tasks -------------------------------------------------

export async function sendMessageAction(applicationId: string, body: string): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  const application = await loadApplication(ctx, applicationId);
  if (!application) return fail(NOT_FOUND_ERROR);
  const text = clean(body, 4000);
  if (text === "") return fail("Mesaj metnini yazınız.");

  const { error } = await ctx.supabase.from("application_messages").insert({ application_id: applicationId, author_id: ctx.user.id, body: text });
  if (error) {
    logError("staff.send_message", error);
    return fail(GENERIC_ERROR);
  }
  const notified = await notifyCustomer(ctx, application, "message.new", "Danışmanınızdan yeni mesaj", text.slice(0, 200));
  revalidate(applicationId);
  return done("Mesaj müşteriye iletildi.", notified);
}

/** Internal note visible ONLY to staff. NO notification is sent to the customer. */
export async function addStaffNoteAction(applicationId: string, body: string): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  const application = await loadApplication(ctx, applicationId);
  if (!application) return fail(NOT_FOUND_ERROR);
  const text = clean(body, 4000);
  if (text === "") return fail("Not metnini yazınız.");

  const { error } = await ctx.supabase.from("staff_notes").insert({ application_id: applicationId, author_id: ctx.user.id, body: text });
  if (error) {
    logError("staff.add_note", error);
    return fail(GENERIC_ERROR);
  }
  revalidatePath(staffApplicationPath(applicationId));
  return ok("İç not eklendi.");
}

export async function createTaskAction(applicationId: string, title: string, description: string): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  const application = await loadApplication(ctx, applicationId);
  if (!application) return fail(NOT_FOUND_ERROR);
  const cleanTitle = clean(title, 160);
  if (cleanTitle === "") return fail("Görev başlığını yazınız.");

  const { error } = await ctx.supabase.from("customer_tasks").insert({
    application_id: applicationId,
    title: cleanTitle,
    description: clean(description, 1000),
    created_by: ctx.user.id,
  });
  if (error) {
    logError("staff.create_task", error);
    return fail(GENERIC_ERROR);
  }
  const notified = await notifyCustomer(ctx, application, "task.new", "Sizden bir işlem bekleniyor", cleanTitle);
  revalidate(applicationId);
  return done("Görev oluşturuldu.", notified);
}

export async function setTaskStatusAction(applicationId: string, taskId: string, status: "completed" | "cancelled" | "open"): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  if (!isUuid(applicationId) || !isUuid(taskId)) return fail(NOT_FOUND_ERROR);
  if (status !== "completed" && status !== "cancelled" && status !== "open") return fail("Geçersiz durum.");

  const { data, error } = await ctx.supabase
    .from("customer_tasks")
    .update({
      status,
      completed_at: status === "completed" ? new Date().toISOString() : null,
      completed_by: status === "completed" ? ctx.user.id : null,
    })
    .eq("id", taskId)
    .eq("application_id", applicationId)
    .select("id");
  if (error) {
    logError("staff.set_task_status", error);
    return fail(GENERIC_ERROR);
  }
  if (!data || data.length === 0) return fail(NOT_FOUND_ERROR);
  revalidate(applicationId);
  return ok("Görev güncellendi.");
}

// --- Visa outcome -----------------------------------------------------------

export type VisaOutcomeInput = {
  outcome: string;
  /** Refusal reason (required for a refusal) or a note to the customer. */
  note: string;
  /** New screenshot added with this notice (uploaded and verified as "visa_result"). */
  fileId: string | null;
  /** Keep the existing screenshot if there is no new file? */
  keepCurrentFile: boolean;
};

/** Deletes visa outcome files not attached to the application (replaced or unfinished). */
async function removeUnusedVisaResultFiles(actorId: string, applicationId: string, keepFileId: string | null): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("application_files").select("id").eq("application_id", applicationId).eq("kind", "visa_result");
  if (error) {
    logError("staff.visa_outcome.list_files", error);
    return;
  }
  for (const row of data ?? []) {
    if (row.id === keepFileId) continue;
    const { data: path, error: deleteError } = await admin.rpc("svc_delete_file", { p_actor_id: actorId, p_file_id: row.id });
    if (deleteError) {
      logError("staff.visa_outcome.delete_file", deleteError);
      continue;
    }
    if (typeof path === "string") {
      const { error: removeError } = await admin.storage.from(STORAGE_BUCKET).remove([path]);
      if (removeError) logWarning("staff.visa_outcome.orphan_object", { fileId: String(row.id) });
    }
  }
}

/**
 * Sends the visa outcome (approved / refused) to the customer; the application moves to "Sonuç müşteriye bildirildi".
 * The competent authority makes the decision; staff only pass it on.
 *
 * No session has write access to these columns. After the staff identity and business rule are verified here,
 * the write is done with the service role through svc_set_visa_outcome; the function applies the same rules in the database too.
 */
export async function setVisaOutcomeAction(applicationId: string, input: VisaOutcomeInput): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  if (!isAdminClientConfigured()) return fail(NOT_CONFIGURED_ERROR);
  const application = await loadApplication(ctx, applicationId);
  if (!application) return fail(NOT_FOUND_ERROR);

  // Server action arguments are untrusted.
  const raw: Partial<Record<keyof VisaOutcomeInput, unknown>> = typeof input === "object" && input !== null ? input : {};
  if (!isVisaOutcome(raw.outcome)) return fail("Sonucu seçiniz: onaylandı veya reddedildi.");
  if (raw.note !== undefined && typeof raw.note !== "string") return fail("Açıklama okunamadı.");
  const note = typeof raw.note === "string" ? raw.note.replace(/\r\n?/g, "\n").trim() : "";
  if (raw.fileId !== null && raw.fileId !== undefined && !isUuid(raw.fileId)) return fail(NOT_FOUND_ERROR);
  const newFileId = typeof raw.fileId === "string" ? raw.fileId : null;

  const rule = canStaffSetVisaOutcome(application.status, application.paymentStatus, raw.outcome, note);
  if (!rule.ok) return fail(rule.message);

  const current = await fetchVisaOutcome(ctx.supabase, applicationId);
  const fileToAttach = newFileId ?? (raw.keepCurrentFile === true ? (current?.file?.id ?? null) : null);

  const admin = createAdminClient();
  const { error } = await admin.rpc("svc_set_visa_outcome", {
    p_actor_id: ctx.user.id,
    p_application_id: applicationId,
    p_outcome: raw.outcome,
    p_note: note,
    p_file_id: fileToAttach,
  });
  if (error) {
    const message = error.message ?? "";
    if (message.includes("payment_not_verified")) return fail("Ödeme doğrulanmadan sonuç bildirilemez.");
    if (message.includes("visa_outcome_note_required")) return fail("Ret sebebini yazınız.");
    if (message.includes("visa_outcome_not_allowed")) return fail("Vize sonucu, evraklar tamamlandıktan sonra bildirilebilir.");
    if (message.includes("visa_outcome_file_invalid")) return fail("Ekran görüntüsü bulunamadı. Lütfen dosyayı yeniden seçiniz.");
    if (error.code === "PGRST202") {
      return fail("Bu özellik için veritabanı güncellemesi (20261014000300 numaralı dosya) henüz çalıştırılmadı.");
    }
    logError("staff.visa_outcome", error);
    return fail(GENERIC_ERROR);
  }

  await removeUnusedVisaResultFiles(ctx.user.id, applicationId, fileToAttach);
  const notified = await notifyCustomer(
    ctx,
    application,
    "application.visa_outcome",
    "Vize başvurunuzun sonucu bildirildi",
    "Sonucu görmek için başvurunuzu açıp “Başvuru sonucunu göster” düğmesine tıklayınız.",
  );
  revalidate(applicationId);
  return done(current ? "Vize sonucu güncellendi." : "Vize sonucu müşteriye bildirildi.", notified);
}

/**
 * Permanently deletes the application. The application is first read with the staff
 * member's own session; for a submitted application the application number must have been typed. Deletion is done with the
 * service role through svc_delete_application and the function checks admin rights once more in the database (migration 27).
 * After the records are deleted the files in storage are deleted; a file that cannot be deleted is logged (unreachable without a record).
 */
export async function deleteApplicationAction(applicationId: string, confirmation: unknown): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  if (!ctx.user.isAdmin) return fail(ADMIN_REQUIRED_ERROR);
  if (!isAdminClientConfigured()) return fail(NOT_CONFIGURED_ERROR);
  const application = await loadApplication(ctx, applicationId);
  if (!application) return fail(NOT_FOUND_ERROR);
  const rule = canDeleteApplication(application.status, application.referenceCode, typeof confirmation === "string" ? confirmation.slice(0, 80) : "");
  if (!rule.ok) return fail(rule.message);

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("svc_delete_application", { p_actor_id: ctx.user.id, p_application_id: applicationId });
  if (error) {
    if (error.message?.includes("admin_required")) return fail(ADMIN_REQUIRED_ERROR);
    if (error.message?.includes("not_found")) return fail(NOT_FOUND_ERROR);
    if (error.code === "PGRST202" || error.code === "42883") {
      return fail("Başvuru silme henüz etkin değil (veritabanı güncellemesi, 27. dosya, bekleniyor). Hiçbir şey silinmedi.");
    }
    logError("staff.delete_application", error);
    return fail(GENERIC_ERROR);
  }

  const paths = (Array.isArray(data) ? data : []).filter((p): p is string => typeof p === "string" && p.startsWith(`${applicationId}/`));
  if (paths.length > 0) {
    const { error: removeError } = await admin.storage.from(STORAGE_BUCKET).remove(paths);
    if (removeError) logError("staff.delete_application_storage", removeError, { count: paths.length });
  }
  revalidatePath(ROUTES.staff);
  revalidatePath(ROUTES.customer, "layout");
  return ok("Başvuru kalıcı olarak silindi.");
}
