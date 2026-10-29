import "server-only";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { FormData } from "@/features/application-form/types";
import {
  CURRENCIES,
  isApplicationType,
  isSponsorStatus,
  type ApplicationType,
  type Currency,
  type DocumentRequirement,
  type SponsorStatus,
} from "@/lib/domain/constants";
import { compareCityNames } from "@/features/appointments/cities";
import { compareRules, normalizeApplicationTypes, type DocumentRule } from "@/features/documents/document-rules";
import { bySortOrder } from "@/features/staff/ordering";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireStaff, type CurrentUser } from "../auth";
import { logError } from "../log";
import { isUuid } from "../result";
import {
  DataError,
  fetchApplication,
  fetchAppointmentLetter,
  fetchAppointmentOutsideWindow,
  fetchDocumentSlots,
  fetchExtraDocuments,
  fetchFormData,
  fetchPreferences,
  fetchReceipts,
  fetchRiskAssessment,
  fetchTasks,
  fetchVisaOutcome,
  started,
} from "./queries";
import type { RiskAssessment } from "./queries";
import type { Application, ApplicationFile, AppointmentPreferenceRow, CustomerTask, DocumentSlot, VisaOutcomeInfo } from "./types";

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

function fullName(profile: Row | null | undefined): string | null {
  if (!profile) return null;
  const name = `${str(profile.first_name)} ${str(profile.last_name)}`.trim();
  return name === "" ? null : name;
}

/** Name of the person who performed the action; their e-mail if the profile has no name. */
function personName(profile: Row | null | undefined): string | null {
  return fullName(profile) ?? strOrNull(profile?.email);
}

/**
 * Name of a deleted staff member in past records (migration 21): once the person is deleted there is no profile, so the
 * "Name Surname (deleted staff)" label stored at deletion time is shown in the audit log and internal notes.
 */
function nameOrLabel(row: Row, labelColumn: string): string | null {
  return personName(row.profiles as Row | null) ?? strOrNull(row[labelColumn]);
}

/** Without migration 21 there is no name label column (42703): read without a label. */
async function selectWithLabel<R extends { error: { code?: string } | null }>(read: (columns: string) => PromiseLike<R>, columns: string, label: string): Promise<R> {
  const result = await read(`${columns}, ${label}`);
  return result.error?.code === "42703" ? read(columns) : result;
}

// --- Application detail --------------------------------------------------------

export type StaffMessage = { id: string; body: string; createdAt: string; authorName: string | null };
export type AuditEntry = {
  id: number;
  action: string;
  actorName: string | null;
  /** Was the action performed by staff (not the customer)? In the audit log the name is written in navy with "(Admin)". */
  actorIsStaff: boolean;
  details: Record<string, unknown>;
  createdAt: string;
};

export type StaffApplicationDetail = {
  user: CurrentUser;
  application: Application;
  customer: { name: string; email: string; birthDate: string | null };
  formData: FormData;
  slots: DocumentSlot[];
  receipts: ApplicationFile[];
  /** Appointment letter uploaded by the consultant (migration 25). */
  appointmentLetter: ApplicationFile | null;
  /** Extra documents the customer sent after submission (migration 26). */
  extraDocuments: ApplicationFile[];
  preferences: AppointmentPreferenceRow[];
  /** Did the customer say "Bu tarihlerin hiçbiri bana uymuyor"? */
  appointmentOutsideWindow: boolean;
  messages: StaffMessage[];
  notes: StaffMessage[];
  tasks: CustomerTask[];
  audit: AuditEntry[];
  cityName: string | null;
  paymentReviewerName: string | null;
  visaOutcome: VisaOutcomeInfo | null;
  /** Appointment locations from Settings (picked when sending the appointment); null without migration 12. */
  appointmentLocations: AppointmentLocation[] | null;
  /** The customer's Risk Assessment Test answers (staff can read them); null if the test was not taken. */
  riskAssessment: RiskAssessment | null;
  /** Status of a cancelled application before cancellation (migration 13; null if not run). */
  cancelledFromStatus: string | null;
};

export async function loadStaffApplication(applicationId: string): Promise<StaffApplicationDetail> {
  // The page is rendered on every request; queries (the Supabase client reads the clock) are not started during prerendering.
  await connection();
  if (!isUuid(applicationId)) notFound();
  const supabase = await createClient();
  // For speed: the authorization check, the application and the data attached to it
  // are requested at the same time. No data is returned before staff permission is verified; queries are subject to RLS anyway.
  const staffCheck = started(() => requireStaff());
  const applicationRead = started(() => fetchApplication(supabase, applicationId));
  const related = started(() =>
    Promise.all([
      fetchFormData(supabase, applicationId),
      fetchDocumentSlots(supabase, applicationId),
      fetchReceipts(supabase, applicationId),
      fetchPreferences(supabase, applicationId),
      fetchAppointmentOutsideWindow(supabase, applicationId),
      fetchTasks(supabase, applicationId),
      fetchVisaOutcome(supabase, applicationId),
      fetchAppointmentLetter(supabase, applicationId),
      fetchExtraDocuments(supabase, applicationId),
      loadAppointmentLocations(),
      supabase
        .from("application_messages")
        .select("id, body, created_at, profiles(first_name, last_name, email)")
        .eq("application_id", applicationId)
        .order("created_at", { ascending: false }),
      selectWithLabel(
        (columns) => supabase.from("staff_notes").select(columns).eq("application_id", applicationId).order("created_at", { ascending: false }),
        "id, body, created_at, profiles(first_name, last_name, email)",
        "author_label",
      ),
      selectWithLabel(
        (columns) => supabase.from("audit_log").select(columns).eq("application_id", applicationId).order("created_at", { ascending: false }).limit(200),
        "id, action, details, created_at, profiles(first_name, last_name, email, role)",
        "actor_label",
      ),
      supabase.from("applications").select("payment_reviewed_by, profiles!applications_payment_reviewed_by_fkey(first_name, last_name, email)").eq("id", applicationId).maybeSingle(),
      // Without migration 13 the column does not exist (42703); the stage line shows the cancellation at the first stage.
      supabase.from("applications").select("cancelled_from_status").eq("id", applicationId).maybeSingle(),
    ]),
  );

  const user = await staffCheck;
  const application = await applicationRead;
  if (!application) notFound();
  // Things tied to the applicant and the city, after the application is read (a single round).
  const [riskAssessment, customerResult, cityResult] = await Promise.all([
    fetchRiskAssessment(supabase, application.customerId),
    supabase.from("profiles").select("first_name, last_name, email, birth_date").eq("id", application.customerId).maybeSingle(),
    application.cityId ? supabase.from("cities").select("name").eq("id", application.cityId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  const [formData, slots, receipts, preferences, appointmentOutsideWindow, tasks, visaOutcome, appointmentLetter, extraDocuments, appointmentLocations, messagesResult, notesResult, auditResult, reviewerResult, cancelledResult] =
    await related;

  if (cancelledResult.error && cancelledResult.error.code !== "42703") {
    logError("data.staff.cancelled_from", cancelledResult.error);
    throw new DataError("cancelled_from");
  }
  const cancelledFromStatus = application.status === "cancelled" ? strOrNull((cancelledResult.data as Row | null)?.cancelled_from_status) : null;

  for (const [name, result] of [
    ["messages", messagesResult],
    ["notes", notesResult],
    ["audit", auditResult],
    ["customer", customerResult],
    ["city", cityResult],
    ["reviewer", reviewerResult],
  ] as const) {
    if (result.error) {
      logError(`data.staff.${name}`, result.error);
      throw new DataError(name);
    }
  }

  const mapMessage = (row: Row): StaffMessage => ({
    id: str(row.id),
    body: str(row.body),
    createdAt: str(row.created_at),
    // Only staff write messages; if the author has no profile their account was deleted (migration 21). Notes keep the name.
    authorName: nameOrLabel(row, "author_label") ?? "Silinmiş personel",
  });
  const customer = customerResult.data as Row | null;

  return {
    user,
    application,
    customer: { name: fullName(customer) ?? "—", email: str(customer?.email), birthDate: strOrNull(customer?.birth_date) },
    formData,
    slots,
    receipts,
    appointmentLetter,
    extraDocuments,
    preferences,
    appointmentOutsideWindow,
    messages: ((messagesResult.data ?? []) as Row[]).map(mapMessage),
    notes: ((notesResult.data ?? []) as unknown as Row[]).map(mapMessage),
    tasks,
    audit: ((auditResult.data ?? []) as unknown as Row[]).map((row) => ({
      id: Number(row.id),
      action: str(row.action),
      actorName: nameOrLabel(row, "actor_label"),
      // The name label is only written to records of deleted staff (migration 21); a labelled record without a profile belongs to staff.
      actorIsStaff: (row.profiles as Row | null)?.role === "staff" || (!row.profiles && strOrNull(row.actor_label) !== null),
      details: (typeof row.details === "object" && row.details !== null ? row.details : {}) as Record<string, unknown>,
      createdAt: str(row.created_at),
    })),
    cityName: strOrNull((cityResult.data as Row | null)?.name),
    paymentReviewerName: personName((reviewerResult.data as Row | null)?.profiles as Row | null),
    visaOutcome,
    appointmentLocations,
    riskAssessment,
    cancelledFromStatus,
  };
}

// --- Settings -------------------------------------------------------------------

/**
 * ZIP folder. Settings lists are reordered by dragging; a list without an order
 * is sorted by its old rule (by name).
 */
export type ZipCategory = { id: string; folderName: string; isActive: boolean; sortOrder: number };

export type DocumentTypeConfig = {
  id: string;
  label: string;
  description: string;
  applicationType: ApplicationType | null;
  sponsorStatus: SponsorStatus | null;
  requirement: DocumentRequirement;
  maxFiles: number;
  zipCategoryId: string | null;
  isActive: boolean;
  sortOrder: number;
  /** Only required from applicants under 18. */
  minorsOnly: boolean;
};

export type StaffMember = {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  createdAt: string;
  /** Is two-factor authentication set up? null if it could not be read. */
  mfaEnabled: boolean | null;
  /** Is the user an admin (migration 18; false if the column does not exist). */
  isAdmin: boolean;
};

/** Settings → Appointment cities: with their surcharge; in the set order, without an order İstanbul and Ankara first, the others Turkish alphabetical. */
export type CitySettings = { id: string; name: string; isActive: boolean; surchargeAmount: number; surchargeCurrency: Currency; sortOrder: number };

export async function loadCitySettings(): Promise<CitySettings[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("cities").select("id, name, is_active, surcharge_amount, surcharge_currency, sort_order");
  if (error) {
    logError("data.staff.cities", error);
    throw new DataError("cities");
  }
  return (data as Row[])
    .map((r) => ({
      id: str(r.id),
      name: str(r.name),
      isActive: r.is_active === true,
      surchargeAmount: Number(r.surcharge_amount) || 0,
      surchargeCurrency: (CURRENCIES as readonly string[]).includes(str(r.surcharge_currency)) ? (str(r.surcharge_currency) as Currency) : "TRY",
      sortOrder: Number(r.sort_order) || 0,
    }))
    .sort(bySortOrder((a, b) => compareCityNames(a.name, b.name)));
}

/**
 * Settings → Appointment locations: name, address and Google Maps link (migration 17; empty otherwise); in the set order
 * (migration 20), without an order Turkish alphabetical by name.
 */
export type AppointmentLocation = { id: string; name: string; address: string; mapsUrl: string; isActive: boolean; sortOrder: number };

/** Appointment locations; null if the table does not exist yet (migration 12 not run). */
export async function loadAppointmentLocations(): Promise<AppointmentLocation[] | null> {
  const supabase = await createClient();
  // Without migration 20 there is no order column, without migration 17 no map link column.
  const read = (columns: string) => supabase.from("appointment_locations").select(columns);
  let { data, error }: { data: unknown; error: { code?: string } | null } = await read("id, name, address, is_active, maps_url, sort_order");
  if (error?.code === "42703") ({ data, error } = await read("id, name, address, is_active, maps_url"));
  if (error?.code === "42703") ({ data, error } = await read("id, name, address, is_active"));
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return null;
    logError("data.staff.appointment_locations", error);
    throw new DataError("appointment_locations");
  }
  return (data as Row[])
    .map((r) => ({
      id: str(r.id),
      name: str(r.name),
      address: str(r.address),
      mapsUrl: str(r.maps_url),
      isActive: r.is_active === true,
      sortOrder: Number(r.sort_order) || 0,
    }))
    .sort(bySortOrder((a, b) => a.name.localeCompare(b.name, "tr")));
}

export async function loadZipCategories(): Promise<ZipCategory[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("zip_categories").select("id, folder_name, is_active, sort_order");
  if (error) {
    logError("data.staff.zip_categories", error);
    throw new DataError("zip_categories");
  }
  return (data as Row[])
    .map((r) => ({ id: str(r.id), folderName: str(r.folder_name), isActive: r.is_active === true, sortOrder: Number(r.sort_order) || 0 }))
    .sort(bySortOrder((a, b) => a.folderName.localeCompare(b.folderName, "tr")));
}

/**
 * Document rules (migration 20): which documents are required for which application type combination. null if the table does not
 * exist yet (migration 20 not run); Settings then shows the old grouped document list.
 */
export async function loadDocumentRules(): Promise<DocumentRule[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("document_rules").select("id, application_types, sponsor_status, document_rule_items(document_type_id, requirement)");
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST200") return null;
    logError("data.staff.document_rules", error);
    throw new DataError("document_rules");
  }
  return (data as Row[])
    .map((r): DocumentRule => ({
      id: str(r.id),
      applicationTypes: normalizeApplicationTypes(Array.isArray(r.application_types) ? r.application_types.map(String) : []),
      sponsorStatus: isSponsorStatus(r.sponsor_status) ? r.sponsor_status : null,
      items: (Array.isArray(r.document_rule_items) ? (r.document_rule_items as Row[]) : []).map((item) => ({
        documentTypeId: str(item.document_type_id),
        // A "conditional" rule left over from before migration 26 counts as optional (the conversion the migration performs).
        requirement: item.requirement === "required" ? "required" : "optional",
      })),
    }))
    .sort(compareRules);
}

export async function loadDocumentTypes(): Promise<DocumentTypeConfig[]> {
  const supabase = await createClient();
  const columns = "id, label, description, application_type, sponsor_status, requirement, max_files, zip_category_id, is_active, sort_order";
  let { data, error }: { data: Row[] | null; error: { code?: string } | null } = await supabase
    .from("document_types")
    .select(`${columns}, minors_only`)
    .order("sort_order");
  // If 20261015000100_document_rules.sql has not been applied yet the "minors_only" column does not exist.
  if (error?.code === "42703") ({ data, error } = await supabase.from("document_types").select(columns).order("sort_order"));
  if (error) {
    logError("data.staff.document_types", error);
    throw new DataError("document_types");
  }
  return (data as Row[]).map((r) => ({
    id: str(r.id),
    label: str(r.label),
    description: str(r.description),
    applicationType: isApplicationType(r.application_type) ? r.application_type : null,
    sponsorStatus: isSponsorStatus(r.sponsor_status) ? r.sponsor_status : null,
    requirement: r.requirement === "required" ? "required" : "optional",
    maxFiles: Number(r.max_files) || 10,
    zipCategoryId: strOrNull(r.zip_category_id),
    isActive: r.is_active === true,
    sortOrder: Number(r.sort_order) || 0,
    minorsOnly: r.minors_only === true,
  }));
}

export async function loadStaffMembers(): Promise<StaffMember[]> {
  await requireStaff();
  const supabase = await createClient();
  const read = (columns: string) => supabase.from("profiles").select(columns).eq("role", "staff").order("created_at");
  let { data, error } = await read("id, first_name, last_name, email, is_active, created_at, is_admin");
  // Without migration 18 there is no admin column.
  if (error?.code === "42703") ({ data, error } = await read("id, first_name, last_name, email, is_active, created_at"));
  if (error) {
    logError("data.staff.members", error);
    throw new DataError("staff_members");
  }
  const members = (data ?? []) as unknown as Row[];
  // Whether two-factor authentication is set up is read from the Supabase Auth admin API (the staff member's permission was
  // verified above; requires the service role). If it cannot be read, "unknown" (null) is shown.
  const mfa = await Promise.all(
    members.map(async (r): Promise<boolean | null> => {
      if (!isAdminClientConfigured()) return null;
      const { data: factors, error: mfaError } = await createAdminClient().auth.admin.mfa.listFactors({ userId: str(r.id) });
      if (mfaError) {
        logError("data.staff.members.mfa", mfaError);
        return null;
      }
      return factors.factors.some((f) => f.factor_type === "totp" && f.status === "verified");
    }),
  );
  return members.map((r, i) => ({
    id: str(r.id),
    name: fullName(r) ?? "—",
    email: str(r.email),
    isActive: r.is_active === true,
    createdAt: str(r.created_at),
    mfaEnabled: mfa[i] ?? null,
    isAdmin: r.is_admin === true,
  }));
}

// --- Two-factor authentication recovery code ----------------------------------

/**
 * Status of the signed-in staff member's recovery code (migration 23). The code itself cannot be read; only its creation time.
 * "unavailable": the database update was not run or could not be read (the screen shows no warning and no error).
 */
export async function loadOwnRecoveryCodeStatus(): Promise<{ status: "ok"; createdAt: string | null } | { status: "unavailable" }> {
  const user = await requireStaff();
  if (!isAdminClientConfigured()) return { status: "unavailable" };
  // Identity was verified with requireStaff; only the person's own record is looked up (the recovery code table is read with the service role).
  const { data, error } = await createAdminClient().rpc("svc_staff_recovery_code_created_at", { p_user_id: user.id });
  if (error) {
    if (error.code !== "PGRST202") logError("staff.recovery_code.status", error);
    return { status: "unavailable" };
  }
  return { status: "ok", createdAt: typeof data === "string" ? data : null };
}
