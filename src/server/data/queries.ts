import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildFormData } from "@/features/application-form/engine";
import { compareCityNames } from "@/features/appointments/cities";
import { bySortOrder } from "@/features/staff/ordering";
import type { FormData } from "@/features/application-form/types";
import { isAllowedMimeType } from "@/features/documents/file-validation";
import { RISK_TEST_VERSION } from "@/features/risk-test/definition";
import { normalizeRiskAnswers } from "@/features/risk-test/scoring";
import {
  FILE_KINDS,
  isApplicationType,
  isCurrency,
  isDocumentReviewStatus,
  isPaymentStatus,
  isSponsorStatus,
  isVisaOutcome,
  toApplicationStatus,
  toAppointmentStatus,
  type DocumentRequirement,
  type FileKind,
} from "@/lib/domain/constants";
import { logError, logWarning } from "../log";
import type {
  Application,
  ApplicationFile,
  AppointmentPreferenceRow,
  City,
  CompanyContact,
  CustomerTask,
  DocumentSlot,
  Message,
  PaymentInfo,
  VisaOutcomeInfo,
} from "./types";

/**
 * Data access layer. Functions take a client created with the caller's session;
 * the RLS policies in the database decide which rows come back.
 * Query errors are NOT SWALLOWED SILENTLY: a DataError is thrown and the page's error boundary is shown.
 */
export class DataError extends Error {
  constructor(operation: string) {
    super(`Veri okunamadı: ${operation}`);
    this.name = "DataError";
  }
}

/**
 * Starts a job immediately; its result is awaited later (to request data at the same time as the authorization check). If
 * the job is never awaited because the authorization check redirected, it is marked so its error does not count as an
 * "unhandled rejection"; when awaited the error is still thrown. Data is never returned before authorization is verified; queries are subject to RLS anyway.
 */
export function started<T>(work: () => Promise<T>): Promise<T> {
  const promise = work();
  promise.catch(() => undefined);
  return promise;
}

type Row = Record<string, unknown>;
type Db = SupabaseClient;

function check<T>(operation: string, result: { data: T | null; error: unknown }): T {
  if (result.error) {
    logError(`data.${operation}`, result.error);
    throw new DataError(operation);
  }
  return result.data as T;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0);
const isFileKind = (v: unknown): v is FileKind => typeof v === "string" && (FILE_KINDS as readonly string[]).includes(v);
// "Conditional" records left in the database before migration 26 was run also count as optional (the conversion the migration performs).
const asRequirement = (v: unknown): DocumentRequirement => (v === "required" ? "required" : "optional");

const BASE_APPLICATION_COLUMNS =
  "id, reference_code, customer_id, application_types, sponsor_status, city_id, status, form_locked, payment_status, payment_declared_at, payment_reviewed_at, payment_note, appointment_status, appointment_at, appointment_location, appointment_note, submitted_at, created_at, updated_at";
/** Appointment location columns introduced in migration 12. */
const LOCATION_COLUMNS = `${BASE_APPLICATION_COLUMNS}, appointment_address, appointment_location_id`;
/** Columns introduced in migration 17 (map link, Fee step, form edit request). */
const APPLICATION_COLUMNS = `${LOCATION_COLUMNS}, appointment_maps_url, fee_step_seen_at, form_edit_requested_at, form_edit_request_note`;

type QueryResult = { data: unknown; error: { code?: string } | null };

/**
 * Tries the query with the newest columns; if a database migration has not been run yet (42703: column does not exist) it
 * runs again with the previous column set. Missing columns count as empty.
 */
async function withApplicationColumns<T>(run: (columns: string) => PromiseLike<QueryResult>): Promise<{ data: T | null; error: unknown }> {
  let result: QueryResult = { data: null, error: null };
  for (const columns of [APPLICATION_COLUMNS, LOCATION_COLUMNS, BASE_APPLICATION_COLUMNS]) {
    result = await run(columns);
    if (result.error?.code !== "42703") return result as { data: T | null; error: unknown };
    logWarning("data.application_columns.migration_missing");
  }
  return result as { data: T | null; error: unknown };
}

export function mapApplication(row: Row): Application {
  return {
    id: str(row.id),
    referenceCode: str(row.reference_code),
    customerId: str(row.customer_id),
    applicationTypes: Array.isArray(row.application_types) ? row.application_types.filter(isApplicationType) : [],
    sponsorStatus: isSponsorStatus(row.sponsor_status) ? row.sponsor_status : null,
    cityId: strOrNull(row.city_id),
    status: toApplicationStatus(row.status) ?? "draft",
    formLocked: row.form_locked === true,
    paymentStatus: isPaymentStatus(row.payment_status) ? row.payment_status : "not_due",
    paymentDeclaredAt: strOrNull(row.payment_declared_at),
    paymentReviewedAt: strOrNull(row.payment_reviewed_at),
    paymentNote: strOrNull(row.payment_note),
    appointmentStatus: toAppointmentStatus(row.appointment_status) ?? "not_started",
    appointmentAt: strOrNull(row.appointment_at),
    appointmentLocation: strOrNull(row.appointment_location),
    appointmentAddress: strOrNull(row.appointment_address),
    appointmentLocationId: strOrNull(row.appointment_location_id),
    appointmentMapsUrl: strOrNull(row.appointment_maps_url),
    appointmentNote: strOrNull(row.appointment_note),
    feeStepSeenAt: strOrNull(row.fee_step_seen_at),
    formEditRequestedAt: strOrNull(row.form_edit_requested_at),
    formEditRequestNote: strOrNull(row.form_edit_request_note),
    submittedAt: strOrNull(row.submitted_at),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

function mapFile(row: Row): ApplicationFile | null {
  if (!isAllowedMimeType(str(row.mime_type)) || !isFileKind(row.kind)) return null;
  return {
    id: str(row.id),
    applicationId: str(row.application_id),
    documentId: strOrNull(row.application_document_id),
    kind: row.kind,
    originalName: str(row.original_name),
    mimeType: str(row.mime_type) as ApplicationFile["mimeType"],
    sizeBytes: num(row.size_bytes),
    storagePath: str(row.storage_path),
    createdAt: str(row.created_at),
  };
}

export async function fetchApplication(db: Db, applicationId: string): Promise<Application | null> {
  const row = check<Row | null>(
    "application",
    await withApplicationColumns<Row>((columns) => db.from("applications").select(columns).eq("id", applicationId).maybeSingle()),
  );
  return row ? mapApplication(row) : null;
}

export async function fetchApplicationsOfCustomer(db: Db, customerId: string): Promise<Application[]> {
  const rows = check<Row[]>(
    "applications_of_customer",
    await withApplicationColumns<Row[]>((columns) =>
      db.from("applications").select(columns).eq("customer_id", customerId).order("created_at", { ascending: false }),
    ),
  );
  return rows.map(mapApplication);
}

export async function fetchFormData(db: Db, applicationId: string): Promise<FormData> {
  const rows = check<{ section_id: string; data: unknown }[]>(
    "form_sections",
    await db.from("application_form_sections").select("section_id, data").eq("application_id", applicationId),
  );
  return buildFormData(rows);
}

const FILE_COLUMNS = "id, application_id, application_document_id, kind, original_name, mime_type, size_bytes, storage_path, created_at, status";

async function fetchReadyFiles(db: Db, applicationId: string): Promise<ApplicationFile[]> {
  const rows = check<Row[]>(
    "files",
    await db.from("application_files").select(FILE_COLUMNS).eq("application_id", applicationId).eq("status", "ready").order("created_at"),
  );
  return rows.map(mapFile).filter((f): f is ApplicationFile => f !== null);
}

export async function fetchDocumentSlots(db: Db, applicationId: string): Promise<DocumentSlot[]> {
  const [docRows, files] = await Promise.all([
    db
      .from("application_documents")
      .select(
        "id, application_id, document_type_id, custom_label, custom_description, requirement, max_files, out_of_scope, review_status, review_note, reupload_allowed, requested_by_staff, attachment_file_id, created_at, document_types(label, description, sort_order, zip_categories(folder_name, is_active))",
      )
      .eq("application_id", applicationId),
    fetchReadyFiles(db, applicationId),
  ]);
  const rows = check<Row[]>("document_slots", docRows);

  const slots = rows.map((row): DocumentSlot => {
    const type = (row.document_types ?? null) as Row | null;
    // The ZIP category is only visible to staff (RLS); null for the customer.
    const category = (type?.zip_categories ?? null) as Row | null;
    const id = str(row.id);
    return {
      id,
      applicationId: str(row.application_id),
      documentTypeId: strOrNull(row.document_type_id),
      label: strOrNull(row.custom_label) ?? strOrNull(type?.label) ?? "Belge",
      description: strOrNull(row.custom_description) ?? str(type?.description),
      requirement: asRequirement(row.requirement),
      maxFiles: num(row.max_files) || 10,
      outOfScope: row.out_of_scope === true,
      reviewStatus: isDocumentReviewStatus(row.review_status) ? row.review_status : "pending",
      reviewNote: strOrNull(row.review_note),
      reuploadAllowed: row.reupload_allowed === true,
      requestedByStaff: row.requested_by_staff === true,
      // Custom requests (without a document type) are shown at the end of the list, in creation order.
      sortOrder: type ? num(type.sort_order) : 100000,
      zipFolderName: category && category.is_active === true ? strOrNull(category.folder_name) : null,
      attachment: files.find((f) => f.kind === "staff_attachment" && f.id === row.attachment_file_id) ?? null,
      files: files.filter((f) => f.kind === "document" && f.documentId === id),
    };
  });
  return slots.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "tr"));
}

export async function fetchReceipts(db: Db, applicationId: string): Promise<ApplicationFile[]> {
  return (await fetchReadyFiles(db, applicationId)).filter((f) => f.kind === "payment_receipt");
}

/** Extra documents the customer sent after submission, in the order they were sent. */
export async function fetchExtraDocuments(db: Db, applicationId: string): Promise<ApplicationFile[]> {
  return (await fetchReadyFiles(db, applicationId)).filter((f) => f.kind === "extra_document");
}

/** Appointment letter uploaded by the consultant. An application has at most one appointment letter. */
export async function fetchAppointmentLetter(db: Db, applicationId: string): Promise<ApplicationFile | null> {
  return (await fetchReadyFiles(db, applicationId)).find((f) => f.kind === "appointment_letter") ?? null;
}

export async function fetchPreferences(db: Db, applicationId: string): Promise<AppointmentPreferenceRow[]> {
  const rows = check<Row[]>(
    "appointment_preferences",
    await db.from("appointment_preferences").select("rank, preferred_date, slot").eq("application_id", applicationId).order("rank"),
  );
  return rows.map((r) => ({
    rank: num(r.rank),
    date: str(r.preferred_date),
    slot: r.slot === "evening" ? "evening" : r.slot === "full_day" ? "full_day" : "morning",
  }));
}

/**
 * Did the customer say "Bu tarihlerin hiçbiri bana uymuyor"? If database migration 20261015000300 has not been run yet
 * the column does not exist; then it counts as no.
 */
export async function fetchAppointmentOutsideWindow(db: Db, applicationId: string): Promise<boolean> {
  const result = await db.from("applications").select("appointment_outside_window").eq("id", applicationId).maybeSingle();
  if (result.error && (result.error as { code?: string }).code === "42703") {
    logWarning("data.appointment_outside_window.migration_missing");
    return false;
  }
  const row = check<Row | null>("appointment_outside_window", result);
  return row?.appointment_outside_window === true;
}

export async function fetchMessages(db: Db, applicationId: string): Promise<Message[]> {
  const withReadState = await db
    .from("application_messages")
    .select("id, body, created_at, customer_read_at")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false });
  // If migration 11 (20261016000100_message_reads.sql) has not been applied the column does not exist (42703): messages
  // are read without read state and none counts as "new" (so nothing wrongly looks unread).
  const tracked = withReadState.error?.code !== "42703";
  const rows = check<Row[]>(
    "messages",
    tracked
      ? withReadState
      : await db.from("application_messages").select("id, body, created_at").eq("application_id", applicationId).order("created_at", { ascending: false }),
  );
  return rows.map((r) => ({
    id: str(r.id),
    body: str(r.body),
    createdAt: str(r.created_at),
    authorName: null,
    unread: tracked && r.customer_read_at == null,
  }));
}

export async function fetchTasks(db: Db, applicationId: string): Promise<CustomerTask[]> {
  const rows = check<Row[]>(
    "tasks",
    await db
      .from("customer_tasks")
      .select("id, title, description, status, created_at, completed_at")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: false }),
  );
  return rows.map((r) => ({
    id: str(r.id),
    title: str(r.title),
    description: str(r.description),
    status: r.status === "completed" ? "completed" : r.status === "cancelled" ? "cancelled" : "open",
    createdAt: str(r.created_at),
    completedAt: strOrNull(r.completed_at),
  }));
}

/** Settings visible to the caller (RLS: customers only get those with public + customer visibility). */
export async function fetchSettings(db: Db): Promise<Record<string, unknown>> {
  const rows = check<{ key: string; value: unknown }[]>("settings", await db.from("settings").select("key, value"));
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function paymentInfoFrom(settings: Readonly<Record<string, unknown>>): PaymentInfo {
  const accountHolder = strOrNull(settings["payment.account_holder"]);
  const iban = strOrNull(settings["payment.iban"]);
  return {
    accountHolder,
    bankName: strOrNull(settings["payment.bank_name"]),
    iban,
    instructions: strOrNull(settings["payment.instructions"]),
    receiptUploadEnabled: settings["payment.receipt_upload_enabled"] === true,
    configured: accountHolder !== null && iban !== null,
  };
}

export function companyContactFrom(settings: Readonly<Record<string, unknown>>): CompanyContact {
  return { email: strOrNull(settings["company.contact_email"]), phone: strOrNull(settings["company.contact_phone"]) };
}

/**
 * Appointment cities. The surcharge columns in the table and the fee_items / application_fee_items tables
 * are not read because the portal shows no prices.
 */
/**
 * Appointment cities and their surcharges: in the order set in Settings; without an order, İstanbul and
 * Ankara first, the others Turkish alphabetical. The surcharge is shown to the customer too.
 */
export async function fetchCities(db: Db, options: { activeOnly: boolean }): Promise<City[]> {
  let query = db.from("cities").select("id, name, is_active, surcharge_amount, surcharge_currency, sort_order");
  if (options.activeOnly) query = query.eq("is_active", true);
  const rows = check<Row[]>("cities", await query);
  return rows
    .map((r) => ({
      id: str(r.id),
      name: str(r.name),
      isActive: r.is_active === true,
      surchargeAmount: num(r.surcharge_amount),
      surchargeCurrency: isCurrency(r.surcharge_currency) ? r.surcharge_currency : "TRY",
      sortOrder: num(r.sort_order),
    }))
    .sort(bySortOrder((a, b) => compareCityNames(a.name, b.name)));
}

export type RiskAssessment = { answers: number[]; completedAt: string };

/**
 * The user's saved risk assessment answers (RLS: only their own row, or staff).
 * Returns null if the question set version changed or the record is invalid; the test must be retaken.
 */
export async function fetchRiskAssessment(db: Db, userId: string): Promise<RiskAssessment | null> {
  const row = check<Row | null>(
    "risk_assessment",
    await db.from("risk_assessments").select("version, answers, completed_at").eq("user_id", userId).maybeSingle(),
  );
  if (!row || num(row.version) !== RISK_TEST_VERSION) return null;
  const answers = normalizeRiskAnswers(row.answers);
  return answers ? { answers, completedAt: str(row.completed_at) } : null;
}

/**
 * The recorded visa outcome (RLS: applicant or staff). null if there is no outcome.
 * If database migration 20261014000300 has not been run yet the columns do not exist; then
 * the page does not fail, the outcome counts as absent and a warning is logged.
 */
export async function fetchVisaOutcome(db: Db, applicationId: string): Promise<VisaOutcomeInfo | null> {
  const result = await db
    .from("applications")
    .select("visa_outcome, visa_outcome_note, visa_outcome_file_id, visa_outcome_at")
    .eq("id", applicationId)
    .maybeSingle();
  if (result.error && (result.error as { code?: string }).code === "42703") {
    logWarning("data.visa_outcome.migration_missing");
    return null;
  }
  const row = check<Row | null>("visa_outcome", result);
  if (!row || !isVisaOutcome(row.visa_outcome)) return null;

  let file: VisaOutcomeInfo["file"] = null;
  const fileId = strOrNull(row.visa_outcome_file_id);
  if (fileId) {
    const fileRow = check<Row | null>(
      "visa_outcome_file",
      await db.from("application_files").select("id, mime_type").eq("id", fileId).eq("status", "ready").maybeSingle(),
    );
    if (fileRow) file = { id: str(fileRow.id), mimeType: str(fileRow.mime_type) };
  }
  return { outcome: row.visa_outcome, note: strOrNull(row.visa_outcome_note), at: str(row.visa_outcome_at), file };
}

export type NotificationItem = {
  id: string;
  kind: string;
  applicationId: string | null;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
};

/** The applicant's name from the form in each application (not listed if not filled in). */
export async function fetchApplicantNames(db: Db, applicationIds: readonly string[]): Promise<Map<string, string>> {
  if (applicationIds.length === 0) return new Map();
  const rows = check<Row[]>(
    "applicant_names",
    await db.from("application_form_sections").select("application_id, data").eq("section_id", "personal").in("application_id", [...applicationIds]),
  );
  const names = new Map<string, string>();
  for (const row of rows) {
    const data = (typeof row.data === "object" && row.data !== null ? row.data : {}) as Row;
    const name = `${str(data.firstName)} ${str(data.lastName)}`.replace(/\s+/g, " ").trim();
    if (name) names.set(str(row.application_id), name);
  }
  return names;
}

/** The user's notifications, newest first (RLS: only their own notifications). */
export async function fetchNotifications(db: Db, limit: number): Promise<NotificationItem[]> {
  const rows = check<Row[]>(
    "notifications",
    await db.from("notifications").select("id, kind, application_id, title, body, read_at, created_at").order("created_at", { ascending: false }).limit(limit),
  );
  return rows.map((r) => ({
    id: str(r.id),
    kind: str(r.kind),
    applicationId: strOrNull(r.application_id),
    title: str(r.title),
    body: str(r.body),
    createdAt: str(r.created_at),
    read: r.read_at !== null && r.read_at !== undefined,
  }));
}

/**
 * The application's status history (submission and status changes, oldest first). Only status and time are returned.
 * If database migration 20261014000300 has not been run yet the function does not exist; an empty list is returned.
 */
export async function fetchStatusHistory(db: Db, applicationId: string): Promise<{ status: string; changedAt: string }[]> {
  const result = await db.rpc("application_status_history", { p_application_id: applicationId });
  if (result.error && ["PGRST202", "42883"].includes((result.error as { code?: string }).code ?? "")) {
    logWarning("data.status_history.migration_missing");
    return [];
  }
  const rows = check<Row[]>("status_history", result);
  return rows.map((r) => ({ status: str(r.status), changedAt: str(r.changed_at) }));
}


