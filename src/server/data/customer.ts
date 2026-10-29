import "server-only";
import { readdirSync } from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import { buildApplicationProgress, extraDocumentsFrom, type ApplicationProgress } from "@/features/applications/progress";
import { checkSubmission, type SubmissionIssue } from "@/features/applications/submission";
import { formHasAnyAnswer, pruneFormData, validateForm, type FormValidationResult } from "@/features/application-form/engine";
import type { FormData } from "@/features/application-form/types";
import { parseAppointmentConfig, type AppointmentConfig } from "@/features/appointments/window";
import { extraDocumentLimitFrom } from "@/features/documents/extra-documents";
import { blocksSubmission, type DocumentSlotState } from "@/features/documents/rules";
import { createClient } from "@/lib/supabase/server";
import { todayInIstanbul } from "@/lib/validation/formats";
import { requireCustomer, type CurrentUser } from "../auth";
import { isUuid } from "../result";
import { logError } from "../log";
import {
  DataError,
  fetchApplication,
  fetchAppointmentOutsideWindow,
  fetchCities,
  fetchDocumentSlots,
  fetchFormData,
  fetchPreferences,
  fetchSettings,
  paymentInfoFrom,
} from "./queries";
import type { Application, AppointmentPreferenceRow, City, CustomerTask, DocumentSlot, PaymentInfo } from "./types";

export type WizardStepId = "type" | "form" | "documents" | "appointment" | "fee" | "summary";
export type StepState = "complete" | "incomplete" | "todo";

export type ApplicationContext = {
  user: CurrentUser;
  application: Application;
  today: string;
  formData: FormData;
  formValidation: FormValidationResult;
  slots: DocumentSlot[];
  preferences: AppointmentPreferenceRow[];
  /** Did the customer say "Bu tarihlerin hiçbiri bana uymuyor" (none of these dates suit me)? */
  appointmentOutsideWindow: boolean;
  /** Active appointment cities defined by the company. */
  cities: City[];
  appointmentConfig: AppointmentConfig;
  payment: PaymentInfo;
  /** Number of extra documents that can be sent after submission. */
  extraDocumentLimit: number;
  /** Drafts only: missing items that block submission. */
  issues: SubmissionIssue[];
  steps: Record<WizardStepId, StepState>;
};

export function slotState(slot: DocumentSlot): DocumentSlotState {
  return {
    requirement: slot.requirement,
    outOfScope: slot.outOfScope,
    reuploadAllowed: slot.reuploadAllowed,
    reviewStatus: slot.reviewStatus,
    maxFiles: slot.maxFiles,
    fileCount: slot.files.length,
  };
}

/**
 * Data shared by the pages of one of the customer's applications.
 * If the application does not belong to the user (RLS returns no row) a 404 is shown; the application's existence is not leaked.
 */
export async function loadApplicationContext(applicationId: string): Promise<ApplicationContext> {
  const user = await requireCustomer();
  if (!isUuid(applicationId)) notFound();
  const supabase = await createClient();

  const application = await fetchApplication(supabase, applicationId);
  if (!application || application.customerId !== user.id) notFound();

  const isDraft = application.status === "draft";
  if (isDraft && application.applicationTypes.length > 0) {
    // The document list is synced with the company's current rules (files are not deleted).
    const { error } = await supabase.rpc("sync_application_documents", { p_application_id: applicationId });
    if (error) {
      logError("customer.sync_documents", error);
      throw new DataError("sync_documents");
    }
  }

  const [formData, slots, preferences, cities, settings, appointmentOutsideWindow] = await Promise.all([
    fetchFormData(supabase, applicationId),
    fetchDocumentSlots(supabase, applicationId),
    fetchPreferences(supabase, applicationId),
    fetchCities(supabase, { activeOnly: true }),
    fetchSettings(supabase),
    fetchAppointmentOutsideWindow(supabase, applicationId),
  ]);

  const today = todayInIstanbul();
  const appointmentConfig = parseAppointmentConfig(settings);

  const formValidation = validateForm(pruneFormData(formData), today);
  const issues = isDraft
    ? checkSubmission({
        status: application.status,
        applicationTypes: application.applicationTypes,
        sponsorStatus: application.sponsorStatus,
        cityId: application.cityId,
        activeCityIds: cities.map((c) => c.id),
        formData,
        documents: slots.map((s) => ({ ...slotState(s), label: s.label })),
        preferences: preferences.map((p) => ({ date: p.date, slot: p.slot })),
        preferencesOutsideWindow: appointmentOutsideWindow,
        today,
        appointmentConfig,
      })
    : [];

  const has = (step: SubmissionIssue["step"]) => issues.some((i) => i.step === step);
  const formTouched = formHasAnyAnswer(pruneFormData(formData));
  const steps: Record<WizardStepId, StepState> = {
    type: has("type") ? (application.applicationTypes.length > 0 ? "incomplete" : "todo") : "complete",
    form: has("form") ? (formTouched ? "incomplete" : "todo") : "complete",
    documents: slots.length === 0 ? "todo" : slots.some((s) => blocksSubmission(slotState(s))) ? (slots.some((s) => s.files.length > 0) ? "incomplete" : "todo") : "complete",
    appointment: has("appointment") ? (preferences.length > 0 || application.cityId ? "incomplete" : "todo") : "complete",
    // The Fee step has no required action (the receipt is optional); the mark turns green once the customer opens the page.
    fee: application.feeStepSeenAt ? "complete" : "todo",
    summary: issues.length === 0 ? "complete" : "todo",
  };

  return {
    user,
    application,
    today,
    formData,
    formValidation,
    slots,
    preferences,
    appointmentOutsideWindow,
    cities,
    appointmentConfig,
    payment: paymentInfoFrom(settings),
    extraDocumentLimit: extraDocumentLimitFrom(settings),
    issues,
    steps,
  };
}

/**
 * Steps and alerts in the customer panel (the card on the home page and the application status page compute them from the same data).
 * The result is only dated while the application is in the "Sonuç müşteriye bildirildi" status (`visaOutcomeAt`).
 */
export function customerProgress(
  application: Application,
  data: { history: readonly { status: string; changedAt: string }[]; visaOutcomeAt: string | null; slots: readonly DocumentSlot[]; tasks: readonly CustomerTask[] },
): ApplicationProgress {
  return buildApplicationProgress({
    status: application.status,
    appointmentStatus: application.appointmentStatus,
    paymentStatus: application.paymentStatus,
    paymentNote: application.paymentNote,
    paymentReviewedAt: application.paymentReviewedAt,
    submittedAt: application.submittedAt,
    appointmentAt: application.appointmentAt,
    history: data.history,
    visaOutcomeAt: data.visaOutcomeAt,
    extraDocuments: extraDocumentsFrom(data.slots.map((slot) => ({ ...slotState(slot), requestedByStaff: slot.requestedByStaff }))),
    formOpen: application.status !== "draft" && !application.formLocked,
    openTasks: data.tasks.filter((task) => task.status === "open").map((task) => task.title),
  });
}

/** Image files that actually exist in the public/images/form-help folder. */
export function listAvailableHelpImages(): string[] {
  try {
    return readdirSync(path.join(process.cwd(), "public", "images", "form-help")).filter((name) => /\.(png|jpe?g|webp|svg)$/i.test(name));
  } catch {
    return [];
  }
}
