"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { combinationError, normalizeApplicationTypes } from "@/features/documents/document-rules";
import { isSafeFolderName } from "@/features/export/filenames";
import { changedSortOrders, isCompleteOrder, nextSortOrder } from "@/features/staff/ordering";
import { parseBatchInput, rowFieldErrorKey, type BatchInput } from "@/features/unsaved-changes/drafts";
import { APPLICATION_TYPES, CURRENCIES, DOCUMENT_REQUIREMENTS, SPONSOR_STATUSES } from "@/lib/domain/constants";
import { ROUTES } from "@/lib/site";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { getSiteUrl, isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { isValidEmail, isValidIsoDate, parseMoney } from "@/lib/validation/formats";
import { getCurrentUser, isActiveStaff, staffAccessError, type CurrentUser } from "../auth";
import { logError } from "../log";
import { ADMIN_REQUIRED_ERROR, fail, FORBIDDEN_ERROR, GENERIC_ERROR, isUuid, NOT_CONFIGURED_ERROR, NOT_FOUND_ERROR, ok, SESSION_EXPIRED_ERROR, type ActionResult } from "../result";
import { EXTRA_DOCUMENT_LIMIT_KEY, MAX_EXTRA_DOCUMENT_LIMIT } from "@/features/documents/extra-documents";

/**
 * CONFIGURATION ACTIONS (staff only)
 *
 * Writes use the staff member's own session; RLS and audit log triggers run in the database.
 * Creating/authorizing staff accounts uses the service role because it requires the Supabase Auth admin API,
 * and can only be called by active staff.
 */

type StaffContext = { user: CurrentUser; supabase: SupabaseClient };

async function getStaff(): Promise<StaffContext | { error: string }> {
  if (!isSupabaseConfigured()) return { error: NOT_CONFIGURED_ERROR };
  const user = await getCurrentUser();
  if (!user) return { error: SESSION_EXPIRED_ERROR };
  if (!isActiveStaff(user)) return { error: staffAccessError(user) ?? FORBIDDEN_ERROR };
  return { user, supabase: await createClient() };
}

function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

function refresh(): void {
  revalidatePath(ROUTES.staffSettings, "layout");
  revalidatePath(ROUTES.customer, "layout");
}

// Fee item management was removed (the portal shows no prices);
// the fee_items table stays in the database.

// --- Batch save (the single "Kaydet" in the Settings tabs) --------------------
//
// Each tab sends all changed rows in one request. All of them are validated first; if even one row is
// invalid nothing is written. Then the rows are written; a row that cannot be written is reported with an error, the others
// are saved. Format of the error keys: src/features/unsaved-changes/drafts.ts.

const MAX_BATCH_ROWS = 200;
const INVALID_BATCH = "Gönderilen değişiklikler okunamadı. Sayfayı yenileyip tekrar deneyiniz.";
const BATCH_INVALID_FIELDS = "Lütfen işaretli alanları kontrol ediniz. Hiçbir değişiklik kaydedilmedi.";
const NOTHING_TO_SAVE = "Kaydedilecek değişiklik yok.";

function addRowErrors(row: string, error: z.ZodError, out: Record<string, string>): void {
  for (const issue of error.issues) {
    const key = rowFieldErrorKey(row, String(issue.path[0] ?? "form"));
    if (!(key in out)) out[key] = issue.message;
  }
}

/** Row validation: the valid rows and error messages keyed by row id. */
function validateBatch<S extends z.ZodType>(
  schema: S,
  batch: BatchInput,
): { updates: { id: string; values: z.infer<S> }[]; creates: { key: string; values: z.infer<S> }[]; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const updates: { id: string; values: z.infer<S> }[] = [];
  for (const { id, values } of batch.updates) {
    const parsed = schema.safeParse(values);
    if (parsed.success) updates.push({ id, values: parsed.data });
    else addRowErrors(id, parsed.error, errors);
  }
  const creates: { key: string; values: z.infer<S> }[] = [];
  for (const { key, values } of batch.creates) {
    const parsed = schema.safeParse(values);
    if (parsed.success) creates.push({ key, values: parsed.data });
    else addRowErrors(key, parsed.error, errors);
  }
  return { updates, creates, errors };
}

/** Result shown to the user depending on the write outcome. */
function batchResult(total: number, failures: Record<string, string>, successMessage: string): ActionResult {
  const failed = Object.keys(failures).length;
  if (failed === 0) return ok(successMessage);
  if (failed === total) return fail("Değişiklikler kaydedilemedi. İşaretli satırları kontrol edip tekrar deneyiniz.", failures);
  return fail("Bazı değişiklikler kaydedilemedi; işaretli satırları kontrol edip tekrar deneyiniz. Diğer değişiklikler kaydedildi.", failures);
}

/**
 * Order of newly added rows: appended to the end if the list was ordered by hand in Settings, otherwise the list's old rule
 * (by name) still applies. null if there is no order column (appointment locations before migration 20): no order is written.
 */
async function newRowSortOrders(supabase: SupabaseClient, table: SortableTable, count: number): Promise<(number | null)[]> {
  const { data, error } = await supabase.from(table).select("sort_order");
  if (error) return Array.from({ length: count }, () => null);
  const base = nextSortOrder((data as { sort_order: unknown }[]).map((r) => Number(r.sort_order) || 0));
  return Array.from({ length: count }, (_, i) => (base > 0 ? base + i : 0));
}

const withSortOrder = <T extends object>(row: T, sortOrder: number | null | undefined) => (sortOrder ? { ...row, sort_order: sortOrder } : row);

// --- Appointment cities -----------------------------------------------------

/** Upper limit of the numeric(12, 2) column. */
const MAX_SURCHARGE = 9_999_999_999.99;

const citySchema = z.object({
  name: z.string().trim().min(1, "Şehir adını yazınız.").max(80, "Şehir adı en fazla 80 karakter olabilir."),
  // Turkish notation (1.250 / 1.250,50) or plain (1250.50); empty means no surcharge (0).
  surchargeAmount: z
    .string()
    .trim()
    .max(24, "Tutar çok uzun.")
    .refine((v) => v === "" || parseMoney(v) !== null, "Tutarı 1.250 veya 1.250,50 biçiminde yazınız.")
    .transform((v) => (v === "" ? 0 : Number(parseMoney(v))))
    .refine((v) => v <= MAX_SURCHARGE, "Tutar çok büyük."),
  surchargeCurrency: z.enum(CURRENCIES, { error: "Para birimini seçiniz." }),
  isActive: z.boolean().default(true),
});

function cityRow(values: z.infer<typeof citySchema>) {
  // The order is saved separately with "Sırayı değiştir" (reorderSettingsAction); sort_order is not touched here.
  return { name: values.name, surcharge_amount: values.surchargeAmount, surcharge_currency: values.surchargeCurrency, is_active: values.isActive };
}

function cityWriteError(operation: string, error: { code?: string; message?: string }): string {
  if (error.code === "23505") return "Bu adla bir şehir zaten var.";
  logError(operation, error);
  return GENERIC_ERROR;
}

/** Saves the changed cities in the appointment cities tab and the new cities opened with "Şehir ekle". */
export async function saveCitiesAction(input: unknown): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  const batch = parseBatchInput(input, isUuid, MAX_BATCH_ROWS);
  if (!batch) return fail(INVALID_BATCH);
  const { updates, creates, errors } = validateBatch(citySchema, batch);
  if (Object.keys(errors).length > 0) return fail(BATCH_INVALID_FIELDS, errors);
  if (updates.length === 0 && creates.length === 0) return ok(NOTHING_TO_SAVE);

  // Rows are written one by one because name changes can affect each other; new cities are added last.
  const failures: Record<string, string> = {};
  for (const { id, values } of updates) {
    const { data, error } = await ctx.supabase.from("cities").update(cityRow(values)).eq("id", id).select("id");
    if (error) failures[id] = cityWriteError("settings.save_city", error);
    else if (!data || data.length === 0) failures[id] = "Bu şehir bulunamadı; silinmiş olabilir.";
  }
  const cityOrders = await newRowSortOrders(ctx.supabase, "cities", creates.length);
  for (const [index, { key, values }] of creates.entries()) {
    const { error } = await ctx.supabase.from("cities").insert(withSortOrder(cityRow(values), cityOrders[index])).select("id");
    if (error) failures[key] = cityWriteError("settings.create_city", error);
  }

  const total = updates.length + creates.length;
  if (Object.keys(failures).length < total) refresh();
  return batchResult(total, failures, "Şehirler kaydedildi.");
}

export async function deleteCityAction(id: string): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  if (!isUuid(id)) return fail(NOT_FOUND_ERROR);
  const { error } = await ctx.supabase.from("cities").delete().eq("id", id);
  if (error) {
    logError("settings.delete_city", error);
    return fail(GENERIC_ERROR);
  }
  refresh();
  return ok("Şehir silindi.");
}

// --- Appointment locations --------------------------------------------------
// When sending the appointment date the consultant picks the location from this list; its name and address are copied to the application.
// Appointments already sent are not affected if the location later changes or is deleted.

const MIGRATION_12_MISSING = "Randevu yerleri için veritabanı güncellemesi (12. dosya) henüz çalıştırılmadı.";
const MIGRATION_17_MISSING = "Harita bağlantısı için veritabanı güncellemesi (17. dosya) henüz çalıştırılmadı. Bağlantı alanını boş bırakarak kaydedebilirsiniz.";

// Google Maps link the consultant enters for each location. The customer's
// "Haritada aç" (open in maps) button only opens this link; without a link the button is hidden.
const appointmentLocationSchema = z.object({
  name: z.string().trim().min(1, "Yerin adını yazınız.").max(120, "Yerin adı en fazla 120 karakter olabilir."),
  address: z.string().trim().min(1, "Adresi yazınız.").max(400, "Adres en fazla 400 karakter olabilir."),
  mapsUrl: z
    .string()
    .trim()
    .max(2000, "Bağlantı en fazla 2000 karakter olabilir.")
    .refine((v) => v === "" || /^https:\/\/\S+$/.test(v), "Bağlantı “https://” ile başlamalı ve boşluk içermemelidir.")
    .default(""),
  isActive: z.boolean().default(true),
});

function appointmentLocationRow(values: z.infer<typeof appointmentLocationSchema>, withMaps: boolean) {
  const row = { name: values.name, address: values.address.replace(/\r\n?/g, "\n"), is_active: values.isActive };
  return withMaps ? { ...row, maps_url: values.mapsUrl || null } : row;
}

const isMissingColumn = (code: string | undefined) => code === "42703" || code === "PGRST204";

function appointmentLocationWriteError(operation: string, error: { code?: string; message?: string }): string {
  if (error.code === "23505") return "Bu adla bir randevu yeri zaten var.";
  if (error.code === "42P01" || error.code === "PGRST205") return MIGRATION_12_MISSING;
  if (isMissingColumn(error.code)) return MIGRATION_17_MISSING;
  logError(operation, error);
  return GENERIC_ERROR;
}

/** Saves the changed locations in the appointment locations tab and the new locations opened with "Yer ekle". */
export async function saveAppointmentLocationsAction(input: unknown): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  const batch = parseBatchInput(input, isUuid, MAX_BATCH_ROWS);
  if (!batch) return fail(INVALID_BATCH);
  const { updates, creates, errors } = validateBatch(appointmentLocationSchema, batch);
  if (Object.keys(errors).length > 0) return fail(BATCH_INVALID_FIELDS, errors);
  if (updates.length === 0 && creates.length === 0) return ok(NOTHING_TO_SAVE);

  const failures: Record<string, string> = {};
  // Without migration 17 there is no map link column: a location without a link is saved without it.
  for (const { id, values } of updates) {
    const update = (withMaps: boolean) => ctx.supabase.from("appointment_locations").update(appointmentLocationRow(values, withMaps)).eq("id", id).select("id");
    let { data, error } = await update(true);
    if (isMissingColumn(error?.code) && values.mapsUrl === "") ({ data, error } = await update(false));
    if (error) failures[id] = appointmentLocationWriteError("settings.save_appointment_location", error);
    else if (!data || data.length === 0) failures[id] = "Bu randevu yeri bulunamadı; silinmiş olabilir.";
  }
  const locationOrders = await newRowSortOrders(ctx.supabase, "appointment_locations", creates.length);
  for (const [index, { key, values }] of creates.entries()) {
    const insert = (withMaps: boolean) =>
      ctx.supabase.from("appointment_locations").insert(withSortOrder(appointmentLocationRow(values, withMaps), locationOrders[index])).select("id");
    let { error } = await insert(true);
    if (isMissingColumn(error?.code) && values.mapsUrl === "") ({ error } = await insert(false));
    if (error) failures[key] = appointmentLocationWriteError("settings.create_appointment_location", error);
  }

  const total = updates.length + creates.length;
  if (Object.keys(failures).length < total) refresh();
  return batchResult(total, failures, "Randevu yerleri kaydedildi.");
}

export async function deleteAppointmentLocationAction(id: string): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  if (!isUuid(id)) return fail(NOT_FOUND_ERROR);
  const { data, error } = await ctx.supabase.from("appointment_locations").delete().eq("id", id).select("id");
  if (error) return fail(appointmentLocationWriteError("settings.delete_appointment_location", error));
  if (!data || data.length === 0) return fail("Bu randevu yeri bulunamadı; silinmiş olabilir.");
  refresh();
  return ok("Randevu yeri silindi. Bu yerle bildirilmiş randevuların bilgisi değişmedi.");
}

// --- Document rules and ZIP folder mapping ----------------------------------

const documentTypeSchema = z.object({
  label: z.string().trim().min(1, "Belgenin adını yazınız.").max(160, "Belge adı en fazla 160 karakter olabilir."),
  description: z.string().trim().max(600, "Açıklama en fazla 600 karakter olabilir."),
  requirement: z.enum(DOCUMENT_REQUIREMENTS, { error: "Kuralı seçiniz." }),
  maxFiles: z.coerce.number().int("Tam sayı giriniz.").min(1, "En az 1 olmalıdır.").max(30, "En fazla 30 olabilir."),
  zipCategoryId: z.union([z.string().uuid(), z.null()]),
  isActive: z.boolean(),
});

/** A new document is added together with the application type (and sponsor status) that requires it; it does not change later. */
const newDocumentTypeSchema = documentTypeSchema
  .extend({
    // Empty: a shared document required in every application.
    applicationType: z.union([z.enum(APPLICATION_TYPES), z.literal("")], { error: "Belgenin isteneceği başvuru tipi geçersiz." }),
    sponsorStatus: z.union([z.enum(SPONSOR_STATUSES), z.literal("")], { error: "Sponsor durumu geçersiz." }),
  })
  .refine((v) => v.sponsorStatus === "" || v.applicationType === "sponsored", {
    path: ["sponsorStatus"],
    message: "Sponsor durumu yalnızca sponsorlu başvuru belgelerinde seçilebilir.",
  });

const isDocumentTypeId = (id: string) => /^[a-z][a-z0-9_]{1,60}$/.test(id);

function documentTypeRow(values: z.infer<typeof documentTypeSchema>) {
  return {
    label: values.label,
    description: values.description,
    requirement: values.requirement,
    max_files: values.maxFiles,
    zip_category_id: values.zipCategoryId,
    is_active: values.isActive,
  };
}

/** A new document is added at the end of its group (e.g. the "Emekli" (retired) documents). If the group is empty the group's starting order is used. */
const DOCUMENT_GROUP_START: Record<string, number> = {
  "": 100,
  general_employee: 200,
  self_employed: 300,
  retired: 400,
  student: 500,
  uk_family_visit: 600,
  sponsored: 700,
};

async function nextDocumentSortOrder(supabase: SupabaseClient, applicationType: string, sponsorStatus: string): Promise<number> {
  let query = supabase.from("document_types").select("sort_order").order("sort_order", { ascending: false }).limit(1);
  query = applicationType ? query.eq("application_type", applicationType) : query.is("application_type", null);
  query = sponsorStatus ? query.eq("sponsor_status", sponsorStatus) : query.is("sponsor_status", null);
  const { data, error } = await query;
  if (error) throw error;
  const last = Number((data as { sort_order: unknown }[] | null)?.[0]?.sort_order);
  return (Number.isFinite(last) ? last : DOCUMENT_GROUP_START[applicationType] ?? 1000) + 10;
}

/**
 * Document rules tab (the old grouped list shown when migration 20 has not been run): saves changed documents (name,
 * description, rule, folder, file count, usage) and new documents opened with "Bu gruba belge ekle".
 */
export async function saveDocumentTypesAction(input: unknown): Promise<ActionResult> {
  return saveDocumentTypes(input, "group");
}

/**
 * Document list (since migration 20): documents are a single list; which application requires them is in the rules. A new
 * document is added at the end of the list and is not required in any application until it is added to a rule.
 */
export async function saveDocumentCatalogAction(input: unknown): Promise<ActionResult> {
  return saveDocumentTypes(input, "end");
}

async function saveDocumentTypes(input: unknown, placeNew: "group" | "end"): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  const batch = parseBatchInput(input, isDocumentTypeId, MAX_BATCH_ROWS);
  if (!batch) return fail(INVALID_BATCH);
  const { updates, errors: updateErrors } = validateBatch(documentTypeSchema, { updates: batch.updates, creates: [] });
  const { creates, errors: createErrors } = validateBatch(newDocumentTypeSchema, { updates: [], creates: batch.creates });
  const errors = { ...updateErrors, ...createErrors };
  if (Object.keys(errors).length > 0) return fail(BATCH_INVALID_FIELDS, errors);
  if (updates.length === 0 && creates.length === 0) return ok(NOTHING_TO_SAVE);

  const failures: Record<string, string> = {};
  await Promise.all(
    updates.map(async ({ id, values }) => {
      const { data, error } = await ctx.supabase.from("document_types").update(documentTypeRow(values)).eq("id", id).select("id");
      if (error) {
        logError("settings.save_document_type", error);
        failures[id] = GENERIC_ERROR;
      } else if (!data || data.length === 0) {
        failures[id] = NOT_FOUND_ERROR;
      }
    }),
  );
  // New documents are added one after another: those added to the same group (or the end of the list) are ordered consecutively.
  for (const { key, values } of creates) {
    try {
      const sortOrder =
        placeNew === "group"
          ? await nextDocumentSortOrder(ctx.supabase, values.applicationType, values.sponsorStatus)
          : (await newRowSortOrders(ctx.supabase, "document_types", 1))[0]! + 10;
      const { error } = await ctx.supabase
        .from("document_types")
        .insert({
          ...documentTypeRow(values),
          // The id is generated on the server; text from the user is never used as an id.
          id: `custom_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
          application_type: values.applicationType || null,
          sponsor_status: values.sponsorStatus || null,
          sort_order: sortOrder,
        })
        .select("id");
      if (error) throw error;
    } catch (error) {
      logError("settings.create_document_type", error);
      failures[key] = GENERIC_ERROR;
    }
  }

  const total = updates.length + creates.length;
  if (Object.keys(failures).length < total) refresh();
  return batchResult(
    total,
    failures,
    placeNew === "group"
      ? "Belge kuralları kaydedildi. Kurallar taslak başvurulara bir sonraki açılışta uygulanır; gönderilmiş başvurulara uygulanmaz."
      : creates.length > 0
        ? "Belgeler kaydedildi. Yeni eklenen belge, aşağıdaki kurallardan birine eklenene kadar hiçbir başvuruda istenmez."
        : "Belgeler kaydedildi. Değişiklikler taslak başvurulara bir sonraki açılışta uygulanır; gönderilmiş başvurulara uygulanmaz.",
  );
}

// --- Document rules by application type combination (migration 20) ---------------
// Rule: src/features/documents/document-rules.ts; the customer's list in the database is private.application_required_documents.

const MIGRATION_20_MISSING = "Belge kuralları için veritabanı güncellemesi (20. dosya) henüz çalıştırılmadı.";
const MAX_RULE_ITEMS = 300;

const documentRuleSchema = z
  .object({
    id: z.union([z.string().uuid(), z.null()]),
    applicationTypes: z.array(z.enum(APPLICATION_TYPES, { error: "Başvuru tipi geçersiz." })).max(APPLICATION_TYPES.length),
    sponsorStatus: z.union([z.enum(SPONSOR_STATUSES), z.null()], { error: "Sponsor durumu geçersiz." }),
    items: z
      .array(
        z.object({
          documentTypeId: z.string().refine(isDocumentTypeId, "Belge geçersiz."),
          requirement: z.enum(DOCUMENT_REQUIREMENTS, { error: "Kuralı seçiniz." }),
        }),
      )
      .max(MAX_RULE_ITEMS)
      .refine((items) => new Set(items.map((i) => i.documentTypeId)).size === items.length, "Bir belge kurala bir kez eklenebilir."),
  })
  .strict();

/** Saves the rule (application types, sponsor status, documents and each document's rule) in one go; a new rule is added the same way. */
export async function saveDocumentRuleAction(input: unknown): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  const parsed = documentRuleSchema.safeParse(input);
  if (!parsed.success) return fail("Kural okunamadı. Lütfen seçimleri kontrol ediniz.", fieldErrorsOf(parsed.error));
  const rule = { ...parsed.data, applicationTypes: normalizeApplicationTypes(parsed.data.applicationTypes) };

  // A second rule for the same combination and the validity of the sponsor status are checked here first (for a clear message);
  // the database applies the same constraints.
  const { data: existing, error: readError } = await ctx.supabase.from("document_rules").select("id, application_types, sponsor_status");
  if (readError) {
    if (readError.code === "42P01" || readError.code === "PGRST205") return fail(MIGRATION_20_MISSING);
    logError("settings.document_rule.read", readError);
    return fail(GENERIC_ERROR);
  }
  const others = (existing as { id: string; application_types: string[] | null; sponsor_status: string | null }[]).map((r) => ({
    id: r.id,
    applicationTypes: normalizeApplicationTypes(r.application_types ?? []),
    sponsorStatus: SPONSOR_STATUSES.find((s) => s === r.sponsor_status) ?? null,
  }));
  const problem = combinationError(rule, others);
  if (problem) return fail(problem);

  const { error } = await ctx.supabase.rpc("save_document_rule", {
    p_id: rule.id,
    p_application_types: rule.applicationTypes,
    p_sponsor_status: rule.sponsorStatus,
    p_items: rule.items.map((item) => ({ document_type_id: item.documentTypeId, requirement: item.requirement })),
  });
  if (error) {
    if (error.code === "23505") return fail("Bu başvuru tipi kombinasyonu için zaten bir kural var. Belgeleri o kuralı düzenleyerek değiştiriniz.");
    if (error.code === "23503") return fail("Seçilen belgelerden biri bu arada silinmiş. Sayfayı yenileyip tekrar deneyiniz.");
    if (error.code === "P0002") return fail("Bu kural bulunamadı; silinmiş olabilir. Sayfayı yenileyiniz.");
    if (error.code === "PGRST202" || error.code === "42883") return fail(MIGRATION_20_MISSING);
    logError("settings.document_rule.save", error);
    return fail(GENERIC_ERROR);
  }
  refresh();
  return ok("Kural kaydedildi. Değişiklik taslak başvurulara bir sonraki açılışta uygulanır; gönderilmiş başvurular etkilenmez.");
}

export async function deleteDocumentRuleAction(id: string): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  if (!isUuid(id)) return fail(NOT_FOUND_ERROR);
  const { data, error } = await ctx.supabase.from("document_rules").delete().eq("id", id).select("id");
  if (error) {
    logError("settings.document_rule.delete", error);
    return fail(GENERIC_ERROR);
  }
  if (!data || data.length === 0) return fail("Bu kural bulunamadı; silinmiş olabilir.");
  refresh();
  return ok("Kural silindi. Bu kuraldaki belgeler, başka bir kuralda yoksa taslak başvurularda artık istenmez.");
}

// --- Ordering (drag and drop) -------------------------------------------------

/** Lists whose order can be changed in Settings and their tables. */
const SORTABLE_TABLES = {
  cities: "cities",
  appointment_locations: "appointment_locations",
  zip_categories: "zip_categories",
  document_types: "document_types",
} as const;
type SortableTable = (typeof SORTABLE_TABLES)[keyof typeof SORTABLE_TABLES];
export type SortableList = keyof typeof SORTABLE_TABLES;

/**
 * Saves the list's new order: `ids` is every row in the list, in the desired order. If a row was added or deleted in the
 * meantime nothing is written. Only rows whose order changed are written (every change goes into the audit log).
 */
export async function reorderSettingsAction(list: unknown, ids: unknown): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  if (typeof list !== "string" || !Object.hasOwn(SORTABLE_TABLES, list)) return fail(INVALID_BATCH);
  const table = SORTABLE_TABLES[list as SortableList];
  const isValidId = table === "document_types" ? isDocumentTypeId : isUuid;
  if (!Array.isArray(ids) || ids.length > MAX_BATCH_ROWS * 2 || !ids.every((id) => typeof id === "string" && isValidId(id))) return fail(INVALID_BATCH);

  const { data, error } = await ctx.supabase.from(table).select("id, sort_order");
  if (error) {
    if (isMissingColumn(error.code)) return fail("Randevu yerlerinin sırası için veritabanı güncellemesi (20. dosya) henüz çalıştırılmadı.");
    logError("settings.reorder.read", error);
    return fail(GENERIC_ERROR);
  }
  const current = new Map((data as { id: string; sort_order: unknown }[]).map((r) => [r.id, Number(r.sort_order) || 0]));
  if (!isCompleteOrder(ids as string[], current.keys())) return fail("Liste bu arada değişti. Sayfayı yenileyip sırayı yeniden düzenleyiniz.");

  const changes = changedSortOrders(ids as string[], current);
  for (const { id, sortOrder } of changes) {
    const { error: writeError } = await ctx.supabase.from(table).update({ sort_order: sortOrder }).eq("id", id);
    if (writeError) {
      logError("settings.reorder.write", writeError);
      refresh();
      return fail("Sıra kaydedilirken bir hata oluştu; sıranın bir kısmı kaydedilmiş olabilir. Sayfayı yenileyip kontrol ediniz.");
    }
  }
  refresh();
  return ok(changes.length > 0 ? "Sıra kaydedildi." : "Sıra değişmedi.");
}

/**
 * Deletes a document. Deletion happens in one step in the database (public.delete_document_type): the document is retired,
 * its empty slots in draft applications are removed; if the document is used in a submitted application or in a draft with
 * uploaded files, its record is kept (so files are not lost) and this is reported clearly.
 */
export async function deleteDocumentTypeAction(id: string): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  if (typeof id !== "string" || !isDocumentTypeId(id)) return fail(NOT_FOUND_ERROR);

  const { data, error } = await ctx.supabase.rpc("delete_document_type", { p_id: id });
  if (error) {
    if (error.code === "P0002") return fail("Bu belge bulunamadı; silinmiş olabilir.");
    if (error.code === "PGRST202" || error.code === "42883") {
      logError("settings.delete_document_type.migration_missing", error);
      return fail("Belge silme için veritabanı güncellemesi (20261015000300 dosyası) henüz uygulanmadı. Belge silinmedi.");
    }
    logError("settings.delete_document_type", error);
    return fail(GENERIC_ERROR);
  }
  refresh();
  if (data === "deactivated") {
    return ok(
      "Bu belge gönderilmiş başvurularda veya dosya yüklenmiş taslaklarda kullanıldığı için tamamen silinmedi; kullanım dışı bırakıldı. Yeni başvurularda istenmeyecek, yüklenmiş dosyalar korunur.",
    );
  }
  return ok("Belge silindi.");
}

const zipCategorySchema = z.object({
  folderName: z
    .string()
    .min(1, "Klasör adını yazınız.")
    .max(60, "Klasör adı en fazla 60 karakter olabilir.")
    .refine(isSafeFolderName, 'Klasör adı \\ / : * ? " < > | karakterlerini içeremez, boşlukla başlayıp bitemez ve nokta ile bitemez.'),
  isActive: z.boolean().default(true),
});

function zipRow(values: z.infer<typeof zipCategorySchema>) {
  // The order is saved separately with "Sırayı değiştir" (reorderSettingsAction); sort_order is not touched here.
  return { folder_name: values.folderName, is_active: values.isActive };
}

function zipWriteError(operation: string, error: { code?: string; message?: string }): string {
  if (error.code === "23505") return "Bu adla bir klasör zaten var.";
  logError(operation, error);
  return GENERIC_ERROR;
}

/** Saves the changed folders in the ZIP folders tab and the new folders opened with "Klasör ekle". */
export async function saveZipCategoriesAction(input: unknown): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  const batch = parseBatchInput(input, isUuid, MAX_BATCH_ROWS);
  if (!batch) return fail(INVALID_BATCH);
  const { updates, creates, errors } = validateBatch(zipCategorySchema, batch);
  if (Object.keys(errors).length > 0) return fail(BATCH_INVALID_FIELDS, errors);
  if (updates.length === 0 && creates.length === 0) return ok(NOTHING_TO_SAVE);

  // Rows are written one by one because name changes can affect each other; new folders are added last.
  const failures: Record<string, string> = {};
  for (const { id, values } of updates) {
    const { data, error } = await ctx.supabase.from("zip_categories").update(zipRow(values)).eq("id", id).select("id");
    if (error) failures[id] = zipWriteError("settings.save_zip_category", error);
    else if (!data || data.length === 0) failures[id] = "Bu klasör bulunamadı; silinmiş olabilir.";
  }
  const zipOrders = await newRowSortOrders(ctx.supabase, "zip_categories", creates.length);
  for (const [index, { key, values }] of creates.entries()) {
    const { error } = await ctx.supabase.from("zip_categories").insert(withSortOrder(zipRow(values), zipOrders[index])).select("id");
    if (error) failures[key] = zipWriteError("settings.create_zip_category", error);
  }

  const total = updates.length + creates.length;
  if (Object.keys(failures).length < total) refresh();
  return batchResult(total, failures, "Klasörler kaydedildi.");
}

/** Deletes the folder; documents mapped to it become unmapped (they stay at the ZIP's root). */
export async function deleteZipCategoryAction(id: string): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  if (!isUuid(id)) return fail(NOT_FOUND_ERROR);
  const { error } = await ctx.supabase.from("zip_categories").delete().eq("id", id);
  if (error) {
    logError("settings.delete_zip_category", error);
    return fail(GENERIC_ERROR);
  }
  refresh();
  return ok("Klasör silindi. Bu klasöre eşleştirilmiş belgeler artık ZIP'in kök dizinine konulacaktır.");
}

// --- General settings -------------------------------------------------------

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

const generalSettingsSchema = z.object({
  contactEmail: optionalText(254).refine((v) => v === null || isValidEmail(v), "Geçerli bir e-posta adresi giriniz."),
  contactPhone: optionalText(40),
  accountHolder: optionalText(160),
  bankName: optionalText(160),
  iban: optionalText(42).refine(
    (v) => v === null || /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(v.replace(/\s/g, "").toUpperCase()),
    "Geçerli bir IBAN giriniz.",
  ),
  paymentInstructions: optionalText(1500),
  receiptUploadEnabled: z.boolean(),
  appointmentStartOffsetDays: z.coerce.number().int().min(0, "0 veya daha büyük olmalıdır.").max(30, "En fazla 30 olabilir."),
  appointmentWindowDays: z.coerce.number().int().min(1, "En az 1 olmalıdır.").max(60, "En fazla 60 olabilir."),
  appointmentIncludeWeekends: z.boolean(),
  appointmentExcludedDates: z
    .string()
    .transform((v) => v.split(/[\s,;]+/).filter((d) => d !== ""))
    .refine((dates) => dates.every(isValidIsoDate), "Tarihleri YYYY-AA-GG biçiminde, her satıra bir tane yazınız.")
    .refine((dates) => dates.length <= 200, "En fazla 200 tarih girilebilir."),
  // Retention period for closed applications (months). Empty: automatic deletion is off.
  retentionMonths: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 240), "1 ile 240 arasında bir ay sayısı yazınız veya boş bırakınız."),
  extraDocumentLimit: z.coerce
    .number({ error: "Bir sayı yazınız." })
    .int("Tam sayı yazınız.")
    .min(0, "0 veya daha büyük olmalıdır.")
    .max(MAX_EXTRA_DOCUMENT_LIMIT, `En fazla ${MAX_EXTRA_DOCUMENT_LIMIT} olabilir.`),
});

export async function saveGeneralSettingsAction(input: unknown): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  const parsed = generalSettingsSchema.safeParse(input);
  if (!parsed.success) return fail("Lütfen işaretli alanları kontrol ediniz.", fieldErrorsOf(parsed.error));
  const v = parsed.data;

  const rows: Array<{ key: string; value: unknown; visibility: "public" | "customer" | "staff" }> = [
    { key: "company.contact_email", value: v.contactEmail, visibility: "public" },
    { key: "company.contact_phone", value: v.contactPhone, visibility: "public" },
    { key: "payment.account_holder", value: v.accountHolder, visibility: "customer" },
    { key: "payment.bank_name", value: v.bankName, visibility: "customer" },
    { key: "payment.iban", value: v.iban ? v.iban.replace(/\s/g, "").toUpperCase() : null, visibility: "customer" },
    { key: "payment.instructions", value: v.paymentInstructions, visibility: "customer" },
    { key: "payment.receipt_upload_enabled", value: v.receiptUploadEnabled, visibility: "customer" },
    { key: "appointment.start_offset_days", value: v.appointmentStartOffsetDays, visibility: "customer" },
    { key: "appointment.window_days", value: v.appointmentWindowDays, visibility: "customer" },
    { key: "appointment.include_weekends", value: v.appointmentIncludeWeekends, visibility: "customer" },
    { key: "appointment.excluded_dates", value: Array.from(new Set(v.appointmentExcludedDates)).sort(), visibility: "customer" },
    { key: "retention.closed_months", value: v.retentionMonths, visibility: "staff" },
    { key: EXTRA_DOCUMENT_LIMIT_KEY, value: v.extraDocumentLimit, visibility: "customer" },
  ];

  // An empty field is written as an empty string (""): the database API turns JSON null into SQL NULL and the column cannot
  // be null. Every reader treats an empty string as "not entered";
  // the retention period only applies if it is a number (migration 16).
  const { error } = await ctx.supabase
    .from("settings")
    .upsert(rows.map((r) => ({ ...r, value: r.value ?? "", updated_by: ctx.user.id })), { onConflict: "key" });
  if (error) {
    logError("settings.save_general", error);
    return fail(GENERIC_ERROR);
  }
  refresh();
  return ok("Ayarlar kaydedildi.");
}

// --- Staff accounts ---------------------------------------------------------

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().refine(isValidEmail, "Geçerli bir e-posta adresi giriniz."),
  firstName: z.string().trim().min(1, "Adı yazınız.").max(80),
  lastName: z.string().trim().min(1, "Soyadı yazınız.").max(80),
});

/**
 * Invites a new staff member: Supabase sends the person a link to set their password,
 * then staff rights are granted to the account. An existing account is NEVER granted rights this way.
 */
export async function inviteStaffAction(input: unknown): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  // Staff management is admin-only (migration 18; the database checks too).
  if (!ctx.user.isAdmin) return fail(ADMIN_REQUIRED_ERROR);
  if (!isAdminClientConfigured()) return fail(NOT_CONFIGURED_ERROR);
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return fail("Lütfen işaretli alanları kontrol ediniz.", fieldErrorsOf(parsed.error));

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
    data: { first_name: parsed.data.firstName, last_name: parsed.data.lastName },
    redirectTo: `${getSiteUrl()}/auth/confirm?next=${encodeURIComponent(ROUTES.resetPassword)}`,
  });
  if (error || !data.user) {
    if (error?.code === "email_exists" || error?.status === 422) {
      return fail("Bu e-posta adresiyle zaten bir hesap var. Mevcut bir müşteri hesabına bu ekrandan personel yetkisi verilemez.", {
        email: "Bu e-posta adresi kullanılıyor.",
      });
    }
    if (error) logError("staff.invite", error);
    return fail("Davet gönderilemedi. Lütfen tekrar deneyiniz.");
  }

  const { error: accessError } = await admin.rpc("svc_set_staff_access", {
    p_actor_id: ctx.user.id,
    p_user_id: data.user.id,
    p_role: "staff",
    p_is_active: true,
  });
  if (accessError) {
    logError("staff.invite.grant", accessError);
    return fail("Davet gönderildi ancak personel yetkisi verilemedi. Lütfen kişiyi listeden kontrol ediniz.");
  }
  revalidatePath(ROUTES.staffSettings, "layout");
  return ok("Davet e-postası gönderildi. Kişi, e-postadaki bağlantıyla şifresini belirledikten sonra giriş yapabilir.");
}

/** Enables/disables a staff member's access. Open sessions of a disabled staff member are terminated too. */
export async function setStaffActiveAction(userId: string, isActive: boolean): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  if (!ctx.user.isAdmin) return fail(ADMIN_REQUIRED_ERROR);
  if (!isAdminClientConfigured()) return fail(NOT_CONFIGURED_ERROR);
  if (!isUuid(userId)) return fail(NOT_FOUND_ERROR);
  if (userId === ctx.user.id) return fail("Kendi erişiminizi kapatamazsınız.");

  // Only existing staff records are acted on (RLS: staff read all profiles).
  const { data: target, error: readError } = await ctx.supabase.from("profiles").select("id, role").eq("id", userId).maybeSingle();
  if (readError) {
    logError("staff.set_active.read", readError);
    return fail(GENERIC_ERROR);
  }
  if (!target || target.role !== "staff") return fail(NOT_FOUND_ERROR);

  const admin = createAdminClient();
  const { error } = await admin.rpc("svc_set_staff_access", {
    p_actor_id: ctx.user.id,
    p_user_id: userId,
    p_role: "staff",
    p_is_active: isActive === true,
  });
  if (error) {
    if (error.message?.includes("admin_required")) return fail(ADMIN_REQUIRED_ERROR);
    logError("staff.set_active", error);
    return fail(GENERIC_ERROR);
  }
  // Access is cut off in the database immediately (is_staff() is checked on every query); also block sign-in.
  const { error: banError } = await admin.auth.admin.updateUserById(userId, { ban_duration: isActive ? "none" : "876000h" });
  if (banError) {
    logError("staff.set_active.ban", banError);
    return ok(
      isActive
        ? "Personel yetkisi yeniden verildi ancak giriş engeli kaldırılamadı. Lütfen Supabase panelinden kontrol ediniz."
        : "Personel yetkisi kaldırıldı ancak hesabın girişi engellenemedi. Kişi artık yönetim paneline erişemez; hesabı Supabase panelinden de kapatınız.",
    );
  }
  revalidatePath(ROUTES.staffSettings, "layout");
  return ok(isActive ? "Personelin erişimi yeniden açıldı." : "Personelin erişimi kapatıldı.");
}

/**
 * Grants or revokes admin rights for a staff member. Only an admin can do this; nobody can
 * remove their own admin rights. The write is done with the service role through svc_set_staff_admin; the function checks the
 * same rules again in the database and writes the change to the audit log.
 */
export async function setStaffAdminAction(userId: string, isAdmin: boolean): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  if (!ctx.user.isAdmin) return fail(ADMIN_REQUIRED_ERROR);
  if (!isAdminClientConfigured()) return fail(NOT_CONFIGURED_ERROR);
  if (!isUuid(userId) || typeof isAdmin !== "boolean") return fail(NOT_FOUND_ERROR);
  if (userId === ctx.user.id && !isAdmin) return fail("Kendi yöneticiliğinizi kaldıramazsınız; başka bir yöneticiden isteyiniz.");

  const { error } = await createAdminClient().rpc("svc_set_staff_admin", { p_actor_id: ctx.user.id, p_user_id: userId, p_is_admin: isAdmin });
  if (error) {
    const message = error.message ?? "";
    if (message.includes("admin_required")) return fail(ADMIN_REQUIRED_ERROR);
    if (message.includes("cannot_change_own_access")) return fail("Kendi yöneticiliğinizi kaldıramazsınız; başka bir yöneticiden isteyiniz.");
    if (error.code === "P0002") return fail(NOT_FOUND_ERROR);
    if (error.code === "PGRST202") return fail("Yöneticilik için veritabanı güncellemesi (18. dosya) henüz çalıştırılmadı.");
    logError("staff.set_admin", error);
    return fail(GENERIC_ERROR);
  }
  revalidatePath(ROUTES.staffSettings, "layout");
  return ok(isAdmin ? "Kişi artık yönetici." : "Kişinin yöneticiliği kaldırıldı.");
}

/**
 * Permanently deletes a staff account. Admin only; nobody can delete themselves.
 * First svc_delete_staff disables the person's access and preserves their name in the audit log/internal notes (migration 21), then
 * the authentication account is deleted. If the account cannot be deleted the person's sign-in is blocked and this is reported clearly.
 */
export async function deleteStaffAction(userId: string): Promise<ActionResult> {
  const ctx = await getStaff();
  if ("error" in ctx) return fail(ctx.error);
  if (!ctx.user.isAdmin) return fail(ADMIN_REQUIRED_ERROR);
  if (!isAdminClientConfigured()) return fail(NOT_CONFIGURED_ERROR);
  if (!isUuid(userId)) return fail(NOT_FOUND_ERROR);
  if (userId === ctx.user.id) return fail("Kendi hesabınızı buradan silemezsiniz.");

  const admin = createAdminClient();
  const { error } = await admin.rpc("svc_delete_staff", { p_actor_id: ctx.user.id, p_user_id: userId });
  if (error) {
    const message = error.message ?? "";
    if (message.includes("admin_required")) return fail(ADMIN_REQUIRED_ERROR);
    if (message.includes("cannot_change_own_access")) return fail("Kendi hesabınızı buradan silemezsiniz.");
    if (error.code === "P0002") return fail(NOT_FOUND_ERROR);
    if (error.code === "PGRST202" || error.code === "42883") return fail("Personel silme için veritabanı güncellemesi (21. dosya) henüz çalıştırılmadı. Hiçbir şey silinmedi.");
    logError("staff.delete", error);
    return fail(GENERIC_ERROR);
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) {
    logError("staff.delete.auth", deleteError);
    const { error: banError } = await admin.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
    if (banError) logError("staff.delete.ban", banError);
    revalidatePath(ROUTES.staffSettings, "layout");
    return fail(
      banError
        ? "Kişinin personel yetkisi kaldırıldı ancak hesabı silinemedi ve girişi engellenemedi. Hesabı Supabase panelinden (Authentication → Users) siliniz."
        : "Kişinin personel yetkisi kaldırıldı ve girişi engellendi ancak hesabı silinemedi. Hesabı Supabase panelinden (Authentication → Users) silebilirsiniz.",
    );
  }
  revalidatePath(ROUTES.staffSettings, "layout");
  return ok("Personel hesabı silindi. İşlem geçmişinde ve iç notlarda adı “(silinmiş personel)” ekiyle görünmeye devam eder.");
}
