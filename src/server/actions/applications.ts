"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canFinishFormCorrection, canRequestFormEdit, FORM_EDIT_NOTE_MAX } from "@/features/applications/form-edit";
import { checkSubmission, canCustomerDeclarePayment } from "@/features/applications/submission";
import { getSection, isSectionId } from "@/features/application-form/definition";
import { normalizeSectionData, pruneFormData, validateSection } from "@/features/application-form/engine";
import type { FieldErrors, SectionData, SectionId } from "@/features/application-form/types";
import { parseAppointmentConfig, validateAlternativePreferences, validatePreferences } from "@/features/appointments/window";
import { applyPrefillToForm, buildRiskPrefill } from "@/features/risk-test/prefill";
import { APPLICATION_TERMS_VERSION } from "@/content/legal/application-terms";
import { isApplicationType, isSponsorStatus, STORAGE_BUCKET, type ApplicationType } from "@/lib/domain/constants";
import { customerApplicationPath, ROUTES } from "@/lib/site";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { todayInIstanbul } from "@/lib/validation/formats";
import { getCurrentUser, type CurrentUser } from "../auth";
import { scheduleEmailDelivery } from "../email/deliver";
import {
  fetchApplication,
  fetchAppointmentOutsideWindow,
  fetchCities,
  fetchDocumentSlots,
  fetchFormData,
  fetchPreferences,
  fetchRiskAssessment,
  fetchSettings,
} from "../data/queries";
import { logError, logWarning } from "../log";
import { fail, GENERIC_ERROR, isUuid, NOT_CONFIGURED_ERROR, NOT_FOUND_ERROR, ok, SESSION_EXPIRED_ERROR, type ActionResult } from "../result";

/**
 * CUSTOMER ACTIONS
 *
 * Every action: (1) verifies the session, (2) proves access by reading the target record with the user's own
 * session (under RLS), (3) applies the business rules, (4) writes.
 * Status transitions go through svc_* database functions called with the service role;
 * these functions verify ownership and status once more in the database.
 */

type Session = { user: CurrentUser; supabase: Awaited<ReturnType<typeof createClient>> };

async function getSession(): Promise<Session | { error: string }> {
  if (!isSupabaseConfigured()) return { error: NOT_CONFIGURED_ERROR };
  const user = await getCurrentUser();
  if (!user) return { error: SESSION_EXPIRED_ERROR };
  return { user, supabase: await createClient() };
}

/** Maps the known error codes raised by svc_* functions to Turkish messages. */
function describeDatabaseError(error: { message?: string; code?: string }): string {
  const message = error.message ?? "";
  if (message.includes("draft_limit_reached")) return "Aynı anda en fazla 5 taslak başvurunuz olabilir. Lütfen mevcut taslaklarınızdan birini tamamlayınız veya gerekmeyen bir taslağı siliniz.";
  if (message.includes("application_not_editable") || message.includes("already_submitted")) return "Bu başvuru gönderildiği için değiştirilemez.";
  if (message.includes("appointment_preferences_missing")) return "Göndermeden önce en az bir randevu tercihi seçmelisiniz.";
  // If 20261014000100_optional_fees.sql has not been run in the database yet, the old function rejects an empty fee list.
  if (message.includes("fees_missing")) return "Başvuru şu anda gönderilemiyor: sistem güncellemesi henüz tamamlanmadı. Lütfen danışmanınıza haber veriniz.";
  if (message.includes("preferences_not_editable")) return "Randevu tercihleriniz şu anda değiştirilemez.";
  if (message.includes("payment_not_expected")) return "Bu başvuru için şu anda ödeme bildirimi beklenmiyor.";
  if (message.includes("task_not_open")) return "Bu görev zaten kapatılmış.";
  if (message.includes("form_edit_already_requested")) return "Form düzenleme isteğiniz danışmanınıza zaten iletildi; yanıtını bekleyiniz.";
  if (message.includes("form_already_open")) return "Formunuz zaten düzenlemeye açık.";
  if (message.includes("form_edit_request_not_allowed")) return "Bu aşamada form düzenleme isteği gönderilemez. Sorunuz için danışmanınıza mesaj yazabilirsiniz.";
  if (message.includes("form_correction_not_open")) return "Formunuz şu anda düzenlemeye açık değil. Sayfayı yenileyiniz.";
  if (message.includes("terms_not_accepted")) return "Başvurunuzu göndermek için Başvuru Hizmet Şartları'nı kabul etmelisiniz.";
  // The note is required if database migration 22 has not been run yet.
  if (message.includes("form_edit_note_invalid")) return "İsteğiniz gönderilemedi. Lütfen neyi değiştirmek istediğinizi kısaca yazıp tekrar deneyiniz.";
  // The function is not found if database migration 17 has not been run yet.
  if (error.code === "PGRST202") return "Bu özellik için veritabanı güncellemesi (17. dosya) henüz çalıştırılmadı. Lütfen danışmanınıza haber veriniz.";
  if (error.code === "23505") return "Aynı tarih ve vakti birden fazla kez seçemezsiniz.";
  return GENERIC_ERROR;
}

export async function createApplicationAction(): Promise<ActionResult> {
  const session = await getSession();
  if ("error" in session) return fail(session.error);
  const { user, supabase } = session;

  const { data, error } = await supabase.from("applications").insert({ customer_id: user.id }).select("id").single();
  if (error || !data) {
    if (error) logError("application.create", error);
    return fail(error ? describeDatabaseError(error) : GENERIC_ERROR);
  }
  revalidatePath(ROUTES.customer);
  redirect(customerApplicationPath(data.id as string, "type"));
}

/**
 * The customer deletes their unsubmitted draft. The draft is first read with the customer's own session
 * (RLS proves ownership); deletion is done with the service role through svc_delete_draft, and the function checks ownership
 * and that it is a draft once more in the database. Uploaded files are deleted from storage too.
 */
export async function deleteDraftAction(applicationId: string): Promise<ActionResult> {
  const session = await getSession();
  if ("error" in session) return fail(session.error);
  if (!isAdminClientConfigured()) return fail(NOT_CONFIGURED_ERROR);
  if (!isUuid(applicationId)) return fail(NOT_FOUND_ERROR);
  const { user, supabase } = session;

  const application = await fetchApplication(supabase, applicationId);
  if (!application || application.customerId !== user.id) return fail(NOT_FOUND_ERROR);
  if (application.status !== "draft") return fail("Gönderilmiş başvuru silinemez.");

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("svc_delete_draft", { p_actor_id: user.id, p_application_id: applicationId });
  if (error) {
    if (error.message?.includes("not_a_draft")) return fail("Gönderilmiş başvuru silinemez.");
    if (error.code === "PGRST202" || error.code === "42883") {
      return fail("Taslak silme henüz etkin değil (veritabanı güncellemesi bekleniyor). Hiçbir şey silinmedi.");
    }
    logError("application.delete_draft", error);
    return fail(GENERIC_ERROR);
  }

  const paths = (Array.isArray(data) ? data : []).filter((p): p is string => typeof p === "string");
  if (paths.length > 0) {
    const { error: removeError } = await admin.storage.from(STORAGE_BUCKET).remove(paths);
    // The record is deleted; a file left in storage becomes orphaned. It is logged (the file name is not logged).
    if (removeError) logError("application.delete_draft_storage", removeError, { count: paths.length });
  }
  revalidatePath(ROUTES.customer);
  return ok("Taslak silindi.");
}

export type SetupInput = { applicationTypes: string[]; sponsorStatus: string | null };

export async function saveApplicationSetupAction(applicationId: string, input: SetupInput): Promise<ActionResult> {
  const session = await getSession();
  if ("error" in session) return fail(session.error);
  const { supabase } = session;
  if (!isUuid(applicationId) || typeof input !== "object" || input === null) return fail(NOT_FOUND_ERROR);

  const types: ApplicationType[] = Array.from(new Set((Array.isArray(input.applicationTypes) ? input.applicationTypes : []).filter(isApplicationType)));
  const fieldErrors: Record<string, string> = {};
  if (types.length === 0) fieldErrors.applicationTypes = "En az bir başvuru tipi seçiniz.";

  const sponsored = types.includes("sponsored");
  const sponsorStatus = sponsored && isSponsorStatus(input.sponsorStatus) ? input.sponsorStatus : null;
  if (sponsored && !sponsorStatus) fieldErrors.sponsorStatus = "Sponsorunuzun çalışma durumunu seçiniz.";
  if (Object.keys(fieldErrors).length > 0) return fail("Lütfen işaretli alanları kontrol ediniz.", fieldErrors);

  // RLS + database trigger: these fields can only change in the user's own DRAFT application.
  // The appointment city (city_id) is saved in the appointment preference step.
  const { data, error } = await supabase
    .from("applications")
    .update({ application_types: types, sponsor_status: sponsorStatus })
    .eq("id", applicationId)
    .select("id");
  if (error) {
    logError("application.setup", error);
    return fail(describeDatabaseError(error));
  }
  if (!data || data.length === 0) return fail(NOT_FOUND_ERROR);

  const { error: syncError } = await supabase.rpc("sync_application_documents", { p_application_id: applicationId });
  if (syncError) {
    logError("application.sync_documents", syncError);
    return fail("Başvuru tipiniz kaydedildi ancak evrak listesi güncellenemedi. Lütfen tekrar deneyiniz.");
  }

  revalidatePath(customerApplicationPath(applicationId), "layout");
  return ok("Kaydedildi.");
}

export type SaveSectionResult = ActionResult<{ savedAt: string; errors: FieldErrors }>;

/**
 * Saves a form section. It is saved as a DRAFT even with missing/invalid fields (no progress is lost);
 * validation errors are returned with the response and checked again at submission.
 */
export async function saveFormSectionAction(applicationId: string, sectionId: string, rawData: unknown): Promise<SaveSectionResult> {
  const session = await getSession();
  if ("error" in session) return fail(session.error);
  const { supabase } = session;
  if (!isUuid(applicationId) || !isSectionId(sectionId)) return fail(NOT_FOUND_ERROR);

  const section = getSection(sectionId);
  // Data from the client is untrusted: unknown keys are dropped and lengths are capped.
  const data = normalizeSectionData(section, rawData);

  // RLS: can only be written for the user's own application and if the form is not locked.
  const { data: saved, error } = await supabase
    .from("application_form_sections")
    .upsert({ application_id: applicationId, section_id: sectionId, data }, { onConflict: "application_id,section_id" })
    .select("updated_at");
  if (error) {
    // 42501: RLS refusal (the application belongs to someone else or the form is locked).
    if (error.code === "42501") return fail("Bu başvurunun formu şu anda düzenlemeye kapalı.");
    logError("form.save_section", error);
    return fail("Cevaplarınız kaydedilemedi. İnternet bağlantınızı kontrol edip tekrar deneyiniz.");
  }
  if (!saved || saved.length === 0) return fail("Bu başvurunun formu şu anda düzenlemeye kapalı.");

  const formData = await fetchFormData(supabase, applicationId);
  const errors = validateSection(section, formData[sectionId] ?? {}, formData, todayInIstanbul());
  return ok(undefined, { savedAt: String(saved[0]!.updated_at), errors });
}

/**
 * Saves the appointment preferences and (in a draft) the appointment city.
 * `cityId` is only considered for a draft application when the company has defined cities; the city does not change after submission.
 */
/**
 * Applies the Risk Assessment Test answers to THE WHOLE form (with the customer's one-time approval).
 *
 * Only the application id comes from the client; the values to fill are generated on the server from the customer's saved
 * test answers. Only empty fields are filled; filled fields are never overwritten.
 * The returned `sections` are the new data of the changed sections (the open section's screen is updated with it).
 */
export async function applyRiskPrefillAction(applicationId: string): Promise<ActionResult<{ sections: Partial<Record<SectionId, SectionData>>; filled: number }>> {
  const session = await getSession();
  if ("error" in session) return fail(session.error);
  const { user, supabase } = session;
  if (!isUuid(applicationId)) return fail(NOT_FOUND_ERROR);

  const application = await fetchApplication(supabase, applicationId);
  if (!application || application.customerId !== user.id) return fail(NOT_FOUND_ERROR);
  if (application.formLocked) return fail("Bu başvurunun formu şu anda düzenlemeye kapalı.");

  const assessment = await fetchRiskAssessment(supabase, user.id);
  if (!assessment) return fail("Kayıtlı bir Risk Analiz Testi sonucunuz bulunamadı. Lütfen testi yeniden yapınız.");

  const formData = await fetchFormData(supabase, applicationId);
  const { sections, filled } = applyPrefillToForm(formData, buildRiskPrefill(assessment.answers));
  if (filled === 0) return ok("Doldurulacak boş alan kalmadı.", { sections: {}, filled: 0 });

  const rows = (Object.keys(sections) as SectionId[]).map((sectionId) => {
    const data = normalizeSectionData(getSection(sectionId), sections[sectionId]);
    sections[sectionId] = data;
    return { application_id: applicationId, section_id: sectionId, data };
  });
  // RLS: can only be written for the user's own application and if the form is not locked.
  const { data: saved, error } = await supabase.from("application_form_sections").upsert(rows, { onConflict: "application_id,section_id" }).select("section_id");
  if (error) {
    if (error.code === "42501") return fail("Bu başvurunun formu şu anda düzenlemeye kapalı.");
    logError("form.apply_risk_prefill", error);
    return fail("Cevaplarınız forma yazılamadı. İnternet bağlantınızı kontrol edip tekrar deneyiniz.");
  }
  if (!saved || saved.length !== rows.length) return fail("Bu başvurunun formu şu anda düzenlemeye kapalı.");

  revalidatePath(customerApplicationPath(applicationId), "layout");
  return ok(undefined, { sections, filled });
}

export async function saveAppointmentPreferencesAction(
  applicationId: string,
  input: unknown,
  cityId: string | null = null,
  outsideWindow: unknown = false,
): Promise<ActionResult> {
  const session = await getSession();
  if ("error" in session) return fail(session.error);
  const { user, supabase } = session;
  if (!isUuid(applicationId)) return fail(NOT_FOUND_ERROR);
  if (!isAdminClientConfigured()) return fail(NOT_CONFIGURED_ERROR);

  const application = await fetchApplication(supabase, applicationId);
  if (!application || application.customerId !== user.id) return fail(NOT_FOUND_ERROR);
  if (!(application.status === "draft" || application.appointmentStatus === "preferences_requested")) {
    return fail("Randevu tercihleriniz şu anda değiştirilemez.");
  }

  let cityToSave: string | null | undefined;
  if (application.status === "draft") {
    const cities = await fetchCities(supabase, { activeOnly: true });
    if (cities.length > 0) {
      const chosen = typeof cityId === "string" && isUuid(cityId) ? cities.find((c) => c.id === cityId) : undefined;
      if (!chosen) return fail("Lütfen randevu şehrini seçiniz.", { cityId: "Randevu şehrini seçiniz." });
      cityToSave = chosen.id;
    }
  }

  // "Bu tarihlerin hiçbiri bana uymuyor": 1–3 of the following working days.
  const outside = outsideWindow === true;
  const settings = await fetchSettings(supabase);
  const config = parseAppointmentConfig(settings);
  const validation = outside ? validateAlternativePreferences(input, todayInIstanbul(), config) : validatePreferences(input, todayInIstanbul(), config);
  if (!validation.ok) return fail(validation.message);

  if (cityToSave !== undefined && cityToSave !== application.cityId) {
    // RLS + database trigger: can only change in the user's own DRAFT application.
    const { data, error: cityError } = await supabase.from("applications").update({ city_id: cityToSave }).eq("id", applicationId).select("id");
    if (cityError || !data || data.length === 0) {
      if (cityError) logError("appointment.save_city", cityError);
      return fail(cityError ? describeDatabaseError(cityError) : NOT_FOUND_ERROR);
    }
  }

  // The fourth parameter is only sent when needed: so normal preferences can still be saved as before when the database
  // update (20261015000300) has not been applied.
  const { error } = await createAdminClient().rpc("svc_set_appointment_preferences", {
    p_actor_id: user.id,
    p_application_id: applicationId,
    p_preferences: validation.preferences,
    ...(outside ? { p_outside_window: true } : {}),
  });
  if (error) {
    logError("appointment.save_preferences", error);
    if (outside && (error.code === "PGRST202" || error.code === "42883")) {
      return fail("“Bu tarihlerin hiçbiri bana uymuyor” seçeneği henüz etkin değil (veritabanı güncellemesi bekleniyor). Tercihleriniz kaydedilmedi.");
    }
    return fail(describeDatabaseError(error));
  }
  revalidatePath(customerApplicationPath(applicationId), "layout");
  return ok("Randevu tercihleriniz kaydedildi.");
}

/**
 * Submits the application. The customer must have ticked both confirmations: the declaration that the information is
 * correct and acceptance of the Application Terms of Service. The acceptance is recorded with its version (migration 24);
 * the database also refuses to submit a draft without an acceptance record.
 */
export async function submitApplicationAction(applicationId: string, consents: unknown): Promise<ActionResult<{ issues: string[] }>> {
  const session = await getSession();
  if ("error" in session) return fail(session.error);
  const { user, supabase } = session;
  if (!isUuid(applicationId)) return fail(NOT_FOUND_ERROR);
  if (!isAdminClientConfigured()) return fail(NOT_CONFIGURED_ERROR);
  const accepted = typeof consents === "object" && consents !== null ? (consents as Record<string, unknown>) : {};
  if (accepted.declaration !== true || accepted.terms !== true) {
    return fail("Başvurunuzu göndermek için bilgilerinizin doğruluğunu beyan edip Başvuru Hizmet Şartları'nı kabul etmelisiniz.");
  }

  const application = await fetchApplication(supabase, applicationId);
  if (!application || application.customerId !== user.id) return fail(NOT_FOUND_ERROR);

  // The document list is synced one last time against the current configuration.
  const { error: syncError } = await supabase.rpc("sync_application_documents", { p_application_id: applicationId });
  if (syncError && application.status === "draft") {
    logError("application.sync_documents", syncError);
    return fail(GENERIC_ERROR);
  }

  const [formData, documents, preferences, cities, settings, outsideWindow] = await Promise.all([
    fetchFormData(supabase, applicationId),
    fetchDocumentSlots(supabase, applicationId),
    fetchPreferences(supabase, applicationId),
    fetchCities(supabase, { activeOnly: true }),
    fetchSettings(supabase),
    fetchAppointmentOutsideWindow(supabase, applicationId),
  ]);

  const issues = checkSubmission({
    status: application.status,
    applicationTypes: application.applicationTypes,
    sponsorStatus: application.sponsorStatus,
    cityId: application.cityId,
    activeCityIds: cities.map((c) => c.id),
    formData,
    documents: documents.map((d) => ({
      label: d.label,
      requirement: d.requirement,
      outOfScope: d.outOfScope,
      reuploadAllowed: d.reuploadAllowed,
      reviewStatus: d.reviewStatus,
      maxFiles: d.maxFiles,
      fileCount: d.files.length,
    })),
    preferences: preferences.map((p) => ({ date: p.date, slot: p.slot })),
    preferencesOutsideWindow: outsideWindow,
    today: todayInIstanbul(),
    appointmentConfig: parseAppointmentConfig(settings),
  });
  if (issues.length > 0) {
    return { ok: false, message: "Başvurunuz henüz gönderilemiyor. Lütfen aşağıdaki eksikleri tamamlayınız." , fieldErrors: Object.fromEntries(issues.map((issue, i) => [`issue_${i}`, issue.message])) };
  }

  const admin = createAdminClient();

  // Old answers of hidden conditional fields are also removed from the stored record.
  const pruned = pruneFormData(formData);
  const { error: pruneError } = await admin.from("application_form_sections").upsert(
    Object.entries(pruned).map(([sectionId, data]) => ({ application_id: applicationId, section_id: sectionId, data })),
    { onConflict: "application_id,section_id" },
  );
  if (pruneError) {
    logError("application.prune_form", pruneError);
    return fail(GENERIC_ERROR);
  }

  // The terms acceptance is recorded right before submission with the text's version (the customer's identity and confirmations were verified above).
  const { error: termsError } = await admin.rpc("svc_accept_application_terms", {
    p_actor_id: user.id,
    p_application_id: applicationId,
    p_version: APPLICATION_TERMS_VERSION,
  });
  if (termsError) {
    if (termsError.code === "PGRST202") {
      return fail("Başvuru şu anda gönderilemiyor: sistem güncellemesi henüz tamamlanmadı. Lütfen danışmanınıza haber veriniz.");
    }
    logError("application.accept_terms", termsError);
    return fail(describeDatabaseError(termsError));
  }

  // Statuses are written in a single database transaction. Since the portal shows no prices
  // the fee breakdown is sent empty (see supabase/migrations/20261014000100_optional_fees.sql).
  const { error } = await admin.rpc("svc_submit_application", {
    p_actor_id: user.id,
    p_application_id: applicationId,
    p_fee_items: [],
  });
  if (error) {
    logError("application.submit", error);
    return fail(describeDatabaseError(error));
  }

  // "Başvurunuz alındı" (application received) notification (and its e-mail if SMTP is configured). The customer's session
  // cannot insert notifications; it is inserted with the service role after verifying above that the caller is the applicant and the submission succeeded.
  const { error: notifyError } = await admin.from("notifications").insert({
    user_id: user.id,
    application_id: applicationId,
    kind: "application.submitted",
    title: "Başvurunuz alındı",
    body: `Başvuru numaranız: ${application.referenceCode}. Sonraki adım ödemenizi yapıp panelinizden “Ödemeyi yaptım” ile bildirmenizdir.`,
  });
  if (notifyError) logError("notification.create", notifyError);
  else scheduleEmailDelivery();

  revalidatePath(ROUTES.customer, "layout");
  redirect(`${customerApplicationPath(applicationId)}?submitted=1`);
}

export async function declarePaymentAction(applicationId: string): Promise<ActionResult> {
  const session = await getSession();
  if ("error" in session) return fail(session.error);
  const { user, supabase } = session;
  if (!isUuid(applicationId)) return fail(NOT_FOUND_ERROR);
  if (!isAdminClientConfigured()) return fail(NOT_CONFIGURED_ERROR);

  const application = await fetchApplication(supabase, applicationId);
  if (!application || application.customerId !== user.id) return fail(NOT_FOUND_ERROR);
  const rule = canCustomerDeclarePayment(application.paymentStatus);
  if (!rule.ok) return fail(rule.message);

  const admin = createAdminClient();
  const { error } = await admin.rpc("svc_declare_payment", { p_actor_id: user.id, p_application_id: applicationId });
  if (error) {
    logError("payment.declare", error);
    return fail(describeDatabaseError(error));
  }
  // Notification and e-mail. The customer's
  // session cannot insert notifications; it is inserted with the service role after ownership and the business rule were verified above.
  const { error: notifyError } = await admin.from("notifications").insert({
    user_id: user.id,
    application_id: applicationId,
    kind: "payment.declared",
    title: "Ödeme bildiriminiz alındı",
    body: "Danışmanlarımız banka hesabını kontrol ettikten sonra ödemeniz doğrulanacak ve size ayrıca bildirilecektir.",
  });
  if (notifyError) logError("notification.create", notifyError);
  else scheduleEmailDelivery();
  revalidatePath(ROUTES.customer, "layout");
  return ok("Ödeme bildiriminiz alındı. Danışmanlarımız hesabı kontrol ettikten sonra ödemeniz doğrulanacaktır.");
}

/**
 * In a draft the customer opened the Fee step: the step's mark turns green. Written with the customer's
 * own session; RLS and the application guard only allow this column on their own draft.
 */
export async function markFeeStepSeenAction(applicationId: string): Promise<ActionResult> {
  const session = await getSession();
  if ("error" in session) return fail(session.error);
  if (!isUuid(applicationId)) return fail(NOT_FOUND_ERROR);
  const { data, error } = await session.supabase
    .from("applications")
    .update({ fee_step_seen_at: new Date().toISOString() })
    .eq("id", applicationId)
    .eq("status", "draft")
    .is("fee_step_seen_at", null)
    .select("id");
  if (error) {
    // The column does not exist if migration 17 has not been run; the step's mark stays empty.
    if (error.code === "42703" || error.code === "PGRST204") logWarning("application.fee_step_seen.migration_missing");
    else logError("application.fee_step_seen", error);
    return fail(GENERIC_ERROR);
  }
  if (data && data.length > 0) revalidatePath(customerApplicationPath(applicationId), "layout");
  return ok();
}

/**
 * The customer asks the consultant to allow changes to the form of a submitted application. The application is read with the customer's own session (RLS proves ownership); the write is done with the service role through
 * svc_request_form_edit, and the function checks ownership and the rule again in the database.
 */
export async function requestFormEditAction(applicationId: string, note: unknown): Promise<ActionResult> {
  const session = await getSession();
  if ("error" in session) return fail(session.error);
  if (!isUuid(applicationId)) return fail(NOT_FOUND_ERROR);
  if (!isAdminClientConfigured()) return fail(NOT_CONFIGURED_ERROR);
  const { user, supabase } = session;

  // The note is optional.
  const text = typeof note === "string" ? note.replace(/\r\n?/g, "\n").trim() : "";
  if (text.length > FORM_EDIT_NOTE_MAX) return fail(`En fazla ${FORM_EDIT_NOTE_MAX} karakter yazabilirsiniz.`, { note: `En fazla ${FORM_EDIT_NOTE_MAX} karakter yazabilirsiniz.` });

  const application = await fetchApplication(supabase, applicationId);
  if (!application || application.customerId !== user.id) return fail(NOT_FOUND_ERROR);
  const rule = canRequestFormEdit(application);
  if (!rule.ok) return fail(rule.message);

  const { error } = await createAdminClient().rpc("svc_request_form_edit", { p_actor_id: user.id, p_application_id: applicationId, p_note: text });
  if (error) {
    logError("application.request_form_edit", error);
    return fail(describeDatabaseError(error));
  }
  revalidatePath(customerApplicationPath(applicationId), "layout");
  return ok("İsteğiniz danışmanınıza iletildi. Danışmanınız formu düzenlemeye açtığında size bildirim gelecektir.");
}

/**
 * "Formu düzenlemeyi tamamladım": the form locks again and the correction notice disappears; if nothing else is expected
 * from the customer the application returns to review automatically. The write is done with the service role through
 * svc_finish_form_correction; the function checks ownership and the rule again in the database.
 */
export async function finishFormCorrectionAction(applicationId: string): Promise<ActionResult> {
  const session = await getSession();
  if ("error" in session) return fail(session.error);
  if (!isUuid(applicationId)) return fail(NOT_FOUND_ERROR);
  if (!isAdminClientConfigured()) return fail(NOT_CONFIGURED_ERROR);
  const { user, supabase } = session;

  const application = await fetchApplication(supabase, applicationId);
  if (!application || application.customerId !== user.id) return fail(NOT_FOUND_ERROR);
  const rule = canFinishFormCorrection(application);
  if (!rule.ok) return fail(rule.message);

  const { error } = await createAdminClient().rpc("svc_finish_form_correction", { p_actor_id: user.id, p_application_id: applicationId });
  if (error) {
    logError("application.finish_form_correction", error);
    return fail(describeDatabaseError(error));
  }
  revalidatePath(ROUTES.customer, "layout");
  return ok("Düzeltmeleriniz danışmanınıza iletildi; formunuz yeniden düzenlemeye kapatıldı.");
}

/**
 * The customer read a consultant message.
 * Runs with the user's own session: the database function only marks a message in their own application.
 */
export async function markMessageReadAction(applicationId: string, messageId: string): Promise<ActionResult> {
  const session = await getSession();
  if ("error" in session) return fail(session.error);
  if (!isUuid(applicationId) || !isUuid(messageId)) return fail(NOT_FOUND_ERROR);
  const { data, error } = await session.supabase.rpc("mark_message_read", { p_message_id: messageId });
  if (error) {
    logError("message.mark_read", error);
    return fail(GENERIC_ERROR);
  }
  if (data !== true) return fail(NOT_FOUND_ERROR);
  revalidatePath(customerApplicationPath(applicationId));
  return ok();
}

export async function completeTaskAction(applicationId: string, taskId: string): Promise<ActionResult> {
  const session = await getSession();
  if ("error" in session) return fail(session.error);
  const { user, supabase } = session;
  if (!isUuid(applicationId) || !isUuid(taskId)) return fail(NOT_FOUND_ERROR);
  if (!isAdminClientConfigured()) return fail(NOT_CONFIGURED_ERROR);

  // RLS: a task is only visible if it belongs to the user's own application.
  const { data: task, error: readError } = await supabase
    .from("customer_tasks")
    .select("id, status")
    .eq("id", taskId)
    .eq("application_id", applicationId)
    .maybeSingle();
  if (readError) {
    logError("task.read", readError);
    return fail(GENERIC_ERROR);
  }
  if (!task) return fail(NOT_FOUND_ERROR);

  const { error } = await createAdminClient().rpc("svc_complete_task", { p_actor_id: user.id, p_task_id: taskId });
  if (error) {
    logError("task.complete", error);
    return fail(describeDatabaseError(error));
  }
  revalidatePath(customerApplicationPath(applicationId), "layout");
  return ok("Görev tamamlandı olarak işaretlendi.");
}

/** Marks a single notification as read (customer panel home page). */
export async function markNotificationReadAction(notificationId: string): Promise<ActionResult> {
  const session = await getSession();
  if ("error" in session) return fail(session.error);
  if (!isUuid(notificationId)) return fail(NOT_FOUND_ERROR);
  // RLS: only the user's own notification is updated; only the read_at column may be written.
  const { error } = await session.supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", notificationId).is("read_at", null);
  if (error) {
    logError("notifications.mark_one_read", error);
    return fail(GENERIC_ERROR);
  }
  revalidatePath(ROUTES.customer, "layout");
  return ok();
}

/**
 * Deletes notifications (Notifications page: a single notification or "Okunanları temizle"). The page calls it when the "Geri al" period ends.
 * RLS: only the user's own notifications are deleted.
 */
export async function deleteNotificationsAction(ids: unknown): Promise<ActionResult> {
  const session = await getSession();
  if ("error" in session) return fail(session.error);
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200 || !ids.every(isUuid)) return fail("Silinecek bildirim bulunamadı.");
  const { error } = await session.supabase.from("notifications").delete().in("id", ids).select("id");
  if (error) {
    logError("notifications.delete", error);
    // Permission to delete notifications comes with database migration 20261015000300.
    if (error.code === "42501") return fail("Bildirim silme henüz etkin değil (veritabanı güncellemesi bekleniyor). Bildirim silinmedi.");
    return fail(GENERIC_ERROR);
  }
  revalidatePath(ROUTES.customer, "layout");
  return ok();
}

export async function markNotificationsReadAction(): Promise<ActionResult> {
  const session = await getSession();
  if ("error" in session) return fail(session.error);
  // RLS: only the user's own notifications are updated; only the read_at column may be written.
  const { error } = await session.supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  if (error) {
    logError("notifications.mark_read", error);
    return fail(GENERIC_ERROR);
  }
  revalidatePath(ROUTES.customer, "layout");
  return ok();
}
