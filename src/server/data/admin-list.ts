import "server-only";
import { connection } from "next/server";
import { needsCustomerAction, type DocumentSlotState } from "@/features/documents/rules";
import { appointmentCell, documentsCell, isArchived, paymentCell, type ListCell } from "@/features/staff/admin-list";
import {
  ADMIN_STATES,
  adminStateKey,
  LIST_STAGE_NAMES,
  LIST_TABS,
  listSegments,
  relativeTime,
  stageOfStatus,
  turnOf,
  waitingDays,
  type AdminStateKey,
  type AdminTone,
  type ListTabId,
  type SegmentCode,
  type TurnInfo,
} from "@/features/staff/admin-state";
import {
  APPLICATION_TYPE_LABELS,
  isApplicationType,
  isPaymentStatus,
  toApplicationStatus,
  toAppointmentStatus,
  type ApplicationType,
} from "@/lib/domain/constants";
import { createClient } from "@/lib/supabase/server";
import { formatDateTimeTr } from "@/lib/validation/formats";
import { requireStaff } from "../auth";
import { scheduleRetentionCleanup } from "../retention";
import { logError, logWarning } from "../log";
import { DataError, started } from "./queries";
import { unseenExtraDocumentIds, viewedFileIdsFrom } from "@/features/documents/extra-documents";

/**
 * ADMIN — APPLICATIONS LIST
 * The search, stage, type, draft and "Tamamlananları göster" filters apply with "Filtrele" (address bar); sorting applies
 * immediately. Tab counts reflect the records after filtering. Applications closed more than 7 days ago are only listed
 * with "Tamamlananları göster" selected. Searching by ID/passport number
 * is not supported.
 */

export const ADMIN_PAGE_SIZE = 25;
/** Maximum number of applications read to compute the tab counts (more than enough for a small office). */
const MAX_ROWS = 2000;

export type AdminListFilters = {
  query: string;
  /** 0–5 (the stages in the design) or null. */
  stage: number | null;
  type: ApplicationType | null;
  drafts: boolean;
  /** Also show applications closed (concluded / cancelled) more than 7 days ago? */
  closed: boolean;
  tab: ListTabId;
  sort: "newest" | "oldest";
  page: number;
};

export function parseAdminListFilters(params: Record<string, string | string[] | undefined>): AdminListFilters {
  const one = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");
  const stage = Number(one("stage"));
  const page = Number(one("page"));
  const tab = LIST_TABS.some((t) => t.id === one("tab")) ? (one("tab") as ListTabId) : "all";
  return {
    query: one("q").trim().slice(0, 80),
    stage: one("stage") !== "" && Number.isInteger(stage) && stage >= 0 && stage <= 5 ? stage : null,
    type: isApplicationType(one("type")) ? (one("type") as ApplicationType) : null,
    drafts: one("drafts") === "1",
    closed: one("completed") === "1",
    tab,
    sort: one("sort") === "oldest" ? "oldest" : "newest",
    page: Number.isInteger(page) && page > 0 ? Math.min(page, 10000) : 1,
  };
}

/** The filters as they appear in the address bar (for tab and page links). */
export function adminListQuery(filters: AdminListFilters, overrides: Partial<AdminListFilters> = {}): string {
  const f = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (f.query) params.set("q", f.query);
  if (f.stage !== null) params.set("stage", String(f.stage));
  if (f.type) params.set("type", f.type);
  if (f.drafts) params.set("drafts", "1");
  if (f.closed) params.set("completed", "1");
  if (f.tab !== "all") params.set("tab", f.tab);
  if (f.sort !== "newest") params.set("sort", f.sort);
  if (f.page > 1) params.set("page", String(f.page));
  const text = params.toString();
  return text ? `?${text}` : "";
}

export type AdminListRow = {
  id: string;
  referenceCode: string;
  applicantName: string;
  email: string;
  typeText: string;
  pill: { label: string; tone: AdminTone };
  turn: TurnInfo;
  /** "3 gündür" (for 3 days); null if not shown. */
  wait: { text: string; alert: boolean } | null;
  segments: { code: SegmentCode; name: string; current: boolean }[];
  stepNo: number;
  stepName: string;
  /** Does the customer have a form edit request awaiting a reply (migration 17)? */
  formEditRequested: boolean;
  /** Number of extra documents no consultant has opened yet. */
  newExtraDocuments: number;
  payment: ListCell;
  documents: ListCell;
  appointment: ListCell;
  updatedRelative: string;
  updatedAbsolute: string;
};

export type AdminListResult = {
  rows: AdminListRow[];
  counts: Record<ListTabId, number>;
  /** Number of records in the selected tab. */
  total: number;
  /** Number of old closed applications hidden while "Tamamlananları göster" is off (independent of the tab). */
  hiddenClosed: number;
  pageCount: number;
};

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

type BaseRow = {
  id: string;
  referenceCode: string;
  applicantName: string;
  email: string;
  types: ApplicationType[];
  key: AdminStateKey;
  paymentStatus: ReturnType<typeof toPayment>;
  appointmentStatus: NonNullable<ReturnType<typeof toAppointmentStatus>>;
  appointmentAt: string | null;
  updatedAt: string;
};

function toPayment(value: unknown) {
  return isPaymentStatus(value) ? value : "not_due";
}

export async function loadAdminList(filters: AdminListFilters): Promise<AdminListResult> {
  // The page is rendered on every request; queries (the Supabase client reads the clock) are not started during prerendering.
  await connection();
  const supabase = await createClient();
  // The authorization check and the list query start at the same time (speed); the list is never returned before authorization is verified.
  const staffCheck = started(() => requireStaff());

  let query = supabase
    .from("application_overview")
    .select("id, reference_code, application_types, status, payment_status, appointment_status, appointment_at, updated_at, customer_email, applicant_first_name, applicant_last_name");
  if (!filters.drafts) query = query.neq("status", "draft");
  if (filters.type) query = query.contains("application_types", [filters.type]);
  if (filters.query) {
    // LIKE wildcards are neutralized; the search covers first name, last name, e-mail and application number.
    const escaped = filters.query.toLocaleLowerCase("tr-TR").replace(/[\\%_]/g, (c) => `\\${c}`);
    query = query.like("search_text", `%${escaped}%`);
  }
  const ordered = query.order("updated_at", { ascending: false }).limit(MAX_ROWS);
  const listRead = started(async () => await ordered);
  await staffCheck;
  // Deletes closed applications whose retention period has expired (if a period is set in Settings; at most once an hour, after the response).
  scheduleRetentionCleanup();
  const { data, error } = await listRead;
  if (error) {
    logError("data.admin.list", error);
    throw new DataError("admin_list");
  }

  const all: BaseRow[] = (data as Row[]).map((row) => {
    const status = toApplicationStatus(row.status) ?? "draft";
    const paymentStatus = toPayment(row.payment_status);
    const appointmentStatus = toAppointmentStatus(row.appointment_status) ?? "not_started";
    return {
      id: str(row.id),
      referenceCode: str(row.reference_code),
      applicantName: `${str(row.applicant_first_name)} ${str(row.applicant_last_name)}`.trim() || "—",
      email: str(row.customer_email),
      types: Array.isArray(row.application_types) ? row.application_types.filter(isApplicationType) : [],
      key: adminStateKey({ status, paymentStatus, appointmentStatus }),
      paymentStatus,
      appointmentStatus,
      appointmentAt: typeof row.appointment_at === "string" ? row.appointment_at : null,
      updatedAt: str(row.updated_at),
    };
  });

  const now = new Date();
  const byStage = filters.stage === null ? all : all.filter((row) => ADMIN_STATES[row.key].stage === filters.stage);
  const base = filters.closed ? byStage : byStage.filter((row) => !isArchived(row.key, row.updatedAt, now));
  const hiddenClosed = byStage.length - base.length;
  const inTab = (row: BaseRow, tab: ListTabId) => {
    const owner = LIST_TABS.find((t) => t.id === tab)!.owner;
    return owner === null || ADMIN_STATES[row.key].owner === owner;
  };
  const counts = Object.fromEntries(LIST_TABS.map((t) => [t.id, base.filter((row) => inTab(row, t.id)).length])) as Record<ListTabId, number>;
  const listed = base.filter((row) => inTab(row, filters.tab));
  if (filters.sort === "oldest") listed.reverse();

  const pageCount = Math.max(1, Math.ceil(listed.length / ADMIN_PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);
  const pageRows = listed.slice((page - 1) * ADMIN_PAGE_SIZE, page * ADMIN_PAGE_SIZE);
  const facts = await loadRowFacts(supabase, pageRows.map((row) => row.id));

  const rows = pageRows.map((row): AdminListRow => {
    const info = ADMIN_STATES[row.key];
    const fact = facts.get(row.id) ?? EMPTY_FACTS;
    const turn = turnOf(row.key);
    const days = waitingDays(row.updatedAt, now);
    const codes = listSegments(row.key, fact.extraRequested, stageOfStatus(fact.cancelledFrom));
    const currentStage = row.key === "h" ? codes.indexOf("X") : info.stage;
    const cellFacts = {
      key: row.key,
      paymentStatus: row.paymentStatus,
      receipts: fact.receipts,
      documents: fact.documents,
      appointmentStatus: row.appointmentStatus,
      appointmentAt: row.appointmentAt,
      preferenceCount: fact.preferences,
    };
    return {
      id: row.id,
      referenceCode: row.referenceCode,
      applicantName: row.applicantName,
      email: row.email,
      typeText: row.types.length > 0 ? row.types.map((t) => APPLICATION_TYPE_LABELS[t]).join(", ") : "—",
      pill: { label: info.pill[0], tone: info.pill[1] },
      turn,
      wait: (turn.kind === "us" || turn.kind === "customer") && days >= 1 ? { text: `${days} gündür`, alert: turn.kind === "us" && days >= 3 } : null,
      segments: codes.map((code, i) => ({ code, name: LIST_STAGE_NAMES[i]!, current: i === currentStage && code !== "D" })),
      stepNo: Math.max(currentStage, 0) + 1,
      stepName: row.key === "h" ? "İptal edildi" : LIST_STAGE_NAMES[info.stage]!,
      payment: paymentCell(cellFacts),
      documents: documentsCell(cellFacts),
      appointment: appointmentCell(cellFacts),
      updatedRelative: relativeTime(row.updatedAt, now),
      updatedAbsolute: formatDateTimeTr(row.updatedAt),
      formEditRequested: fact.formEditRequested,
      newExtraDocuments: fact.newExtraDocuments,
    };
  });

  return { rows, counts, total: listed.length, pageCount, hiddenClosed };
}

type RowFacts = {
  receipts: number;
  preferences: number;
  documents: { total: number; approved: number; outstanding: number };
  extraRequested: boolean;
  cancelledFrom: string | null;
  formEditRequested: boolean;
  newExtraDocuments: number;
};
const EMPTY_FACTS: RowFacts = {
  receipts: 0,
  preferences: 0,
  documents: { total: 0, approved: 0, outstanding: 0 },
  extraRequested: false,
  cancelledFrom: null,
  formEditRequested: false,
  newExtraDocuments: 0,
};

/** Document, receipt and preference counts and the pre-cancellation stage of the applications on the page (in one go, per page). */
/** Application ids of unopened extra documents (once per extra document). */
function unseenFiles(rows: readonly Row[], viewed: ReadonlySet<string>): string[] {
  const files = rows.map((f) => ({ id: str(f.id), applicationId: str(f.application_id), kind: str(f.kind), status: str(f.status) }));
  const unseen = new Set(unseenExtraDocumentIds(files, viewed));
  return files.filter((f) => unseen.has(f.id)).map((f) => f.applicationId);
}

async function loadRowFacts(supabase: Awaited<ReturnType<typeof createClient>>, ids: string[]): Promise<Map<string, RowFacts>> {
  const result = new Map<string, RowFacts>();
  if (ids.length === 0) return result;
  const [docs, files, prefs, apps, requests, views] = await Promise.all([
    supabase
      .from("application_documents")
      .select("id, application_id, requirement, max_files, review_status, reupload_allowed, out_of_scope, requested_by_staff")
      .in("application_id", ids),
    supabase.from("application_files").select("id, application_id, application_document_id, kind, status").in("application_id", ids),
    supabase.from("appointment_preferences").select("application_id").in("application_id", ids),
    supabase.from("applications").select("id, cancelled_from_status").in("id", ids),
    supabase.from("applications").select("id").in("id", ids).not("form_edit_requested_at", "is", null),
    // View records of extra documents (for the "Yeni ek evrak" marker; RLS: only staff can read).
    supabase.from("audit_log").select("action, details").eq("action", "file.viewed").eq("details->>kind", "extra_document").in("application_id", ids),
  ]);
  for (const [name, res] of [
    ["documents", docs],
    ["files", files],
    ["preferences", prefs],
  ] as const) {
    if (res.error) {
      logError(`data.admin.list.${name}`, res.error);
      throw new DataError(`admin_list_${name}`);
    }
  }
  // Without migration 13 the pre-cancellation stage cannot be read; the bar shows the review stage.
  if (apps.error && (apps.error as { code?: string }).code !== "42703") {
    logError("data.admin.list.apps", apps.error);
    throw new DataError("admin_list_apps");
  }
  if (apps.error) logWarning("data.admin.list.cancelled_from_missing");
  // Without migration 17 there is no form edit request column.
  if (requests.error && (requests.error as { code?: string }).code !== "42703") {
    logError("data.admin.list.form_requests", requests.error);
    throw new DataError("admin_list_form_requests");
  }
  if (requests.error) logWarning("data.admin.list.form_requests_missing");

  const fileCount = new Map<string, number>();
  const receipts = new Map<string, number>();
  for (const f of (files.data ?? []) as Row[]) {
    if (f.status !== "ready") continue;
    if (f.kind === "document" && typeof f.application_document_id === "string") fileCount.set(f.application_document_id, (fileCount.get(f.application_document_id) ?? 0) + 1);
    if (f.kind === "payment_receipt") receipts.set(str(f.application_id), (receipts.get(str(f.application_id)) ?? 0) + 1);
  }
  for (const id of ids) result.set(id, { ...EMPTY_FACTS, documents: { total: 0, approved: 0, outstanding: 0 }, receipts: receipts.get(id) ?? 0 });
  for (const d of (docs.data ?? []) as Row[]) {
    const facts = result.get(str(d.application_id));
    if (!facts || d.out_of_scope === true) continue;
    const state: DocumentSlotState = {
      requirement: d.requirement === "required" ? "required" : "optional",
      outOfScope: false,
      reuploadAllowed: d.reupload_allowed === true,
      reviewStatus: d.review_status === "approved" || d.review_status === "needs_correction" || d.review_status === "missing" ? d.review_status : "pending",
      maxFiles: Number(d.max_files) || 10,
      fileCount: fileCount.get(str(d.id)) ?? 0,
    };
    // Documents counted: those with files plus the required ones (empty optional documents are not counted).
    if (state.fileCount > 0 || state.requirement !== "optional" || d.requested_by_staff === true) facts.documents.total += 1;
    if (state.reviewStatus === "approved") facts.documents.approved += 1;
    if (needsCustomerAction(state)) facts.documents.outstanding += 1;
    if (d.requested_by_staff === true || state.reviewStatus === "needs_correction" || state.reviewStatus === "missing") facts.extraRequested = true;
  }
  for (const p of (prefs.data ?? []) as Row[]) {
    const facts = result.get(str(p.application_id));
    if (facts) facts.preferences += 1;
  }
  for (const a of (apps.data ?? []) as Row[]) {
    const facts = result.get(str(a.id));
    if (facts) facts.cancelledFrom = typeof a.cancelled_from_status === "string" ? a.cancelled_from_status : null;
  }
  for (const a of (requests.data ?? []) as Row[]) {
    const facts = result.get(str(a.id));
    if (facts) facts.formEditRequested = true;
  }
  // If the marker cannot be read the list is still shown; the error is logged and no marker appears.
  if (views.error) logError("data.admin.list.extra_views", views.error);
  else {
    const viewed = viewedFileIdsFrom((views.data ?? []) as { action: string; details: unknown }[]);
    for (const f of unseenFiles((files.data ?? []) as Row[], viewed)) {
      const facts = result.get(f);
      if (facts) facts.newExtraDocuments += 1;
    }
  }
  return result;
}

