import { z } from "zod";
import {
  addDaysIso,
  formatDateTr,
  formatMoneyTr,
  formatMonthTr,
  isValidEmail,
  isValidIsoDate,
  isValidIsoMonth,
  isValidPhone,
  parseMoney,
  todayInIstanbul,
} from "@/lib/validation/formats";
import { isValidNationalId, normalizeNationalId } from "@/lib/validation/national-id";
import { FORM_SECTIONS, NO, YES } from "./definition";
import type {
  Condition,
  DateBound,
  DateField,
  Field,
  FieldErrors,
  FormData,
  MonthField,
  RepeatField,
  ScalarField,
  Section,
  SectionData,
  SectionId,
  SectionStatus,
} from "./types";

type Obj = Record<string, unknown>;

const DEFAULT_TEXT_MAX = 200;
const DEFAULT_TEXTAREA_MAX = 1000;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const part of path.split(".")) {
    if (!isObj(current)) return undefined;
    current = current[part];
  }
  return current;
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

export function isConditionMet(condition: Condition, local: Obj, root: FormData): boolean {
  if ("all" in condition) return condition.all.every((c) => isConditionMet(c, local, root));
  if ("any" in condition) return condition.any.some((c) => isConditionMet(c, local, root));
  const value = getPath(condition.scope === "root" ? root : local, condition.path);
  if (typeof value !== "string") return false;
  if ("equals" in condition) return value === condition.equals;
  return condition.in.includes(value);
}

export function isFieldVisible(field: Field, local: Obj, root: FormData): boolean {
  return field.visibleWhen ? isConditionMet(field.visibleWhen, local, root) : true;
}

// ---------------------------------------------------------------------------
// Answer-dependent number of entries in repeat fields
// ---------------------------------------------------------------------------

/** Minimum / maximum number of entries in a repeat field; based on the related question's answer if `countBy` is given. */
export function repeatLimits(field: RepeatField, local: Obj, root: FormData): { min: number; max: number } {
  if (!field.countBy) return { min: field.min, max: field.max };
  const answer = getPath(field.countBy.scope === "root" ? root : local, field.countBy.path);
  const limits = typeof answer === "string" ? field.countBy.limits[answer] : undefined;
  return limits ? { min: limits.min, max: Math.min(limits.max, field.max) } : { min: field.min, max: field.max };
}

// ---------------------------------------------------------------------------
// Date limits
// ---------------------------------------------------------------------------

type DatedField = DateField | MonthField;

/** Truncates date and month-year values to compare them at the same precision ("2026-10-19" → "2026-10"). */
function sameGranularity(field: DatedField, value: string): string {
  return field.type === "month" ? value.slice(0, 7) : value;
}

function boundValue(field: DatedField, bound: DateBound, local: Obj, root: FormData): string | null {
  const raw = getPath(bound.scope === "root" ? root : local, bound.path);
  if (typeof raw !== "string") return null;
  if (field.type === "month" ? !/^\d{4}-\d{2}/.test(raw) : !isValidIsoDate(raw)) return null;
  return sameGranularity(field, raw);
}

function yearsAgo(today: string, years: number): string {
  return `${Number(today.slice(0, 4)) - years}${today.slice(4)}`;
}

/** Error of a date field against other dates and the "last N years" rule; null if none. */
export function dateBoundsError(field: DatedField, value: string, local: Obj, root: FormData, today: string): string | null {
  const own = sameGranularity(field, value);
  for (const bound of field.notBefore ?? []) {
    const other = boundValue(field, bound, local, root);
    if (other !== null && (bound.sameDay ? own < other : own <= other)) return bound.message;
  }
  for (const bound of field.notAfter ?? []) {
    const other = boundValue(field, bound, local, root);
    if (other !== null && (bound.sameDay ? own > other : own >= other)) return bound.message;
  }
  if (field.withinYears && own < sameGranularity(field, yearsAgo(today, field.withinYears))) {
    return `Bu tarih son ${field.withinYears} yıl içinde olmalıdır.`;
  }
  return null;
}

/**
 * Earliest and latest selectable value in the date picker ("YYYY-MM-DD", or "YYYY-MM" for a month-year field).
 * Uses the same rules as validation: past/future, limits relative to other dates, "last N years".
 */
export function dateLimits(field: DatedField, local: Obj, root: FormData, today: string): { min: string | null; max: string | null } {
  const month = field.type === "month";
  const step = (iso: string, days: number) => (month ? shiftMonth(iso, days) : addDaysIso(iso, days));
  const candidatesMin: string[] = [];
  const candidatesMax: string[] = [];
  const todayValue = sameGranularity(field, today);
  if (field.range === "future") candidatesMin.push(todayValue);
  if (field.range === "past") candidatesMax.push(todayValue);
  if (field.withinYears) candidatesMin.push(sameGranularity(field, yearsAgo(today, field.withinYears)));
  for (const bound of field.notBefore ?? []) {
    const other = boundValue(field, bound, local, root);
    if (other !== null) candidatesMin.push(bound.sameDay ? other : step(other, 1));
  }
  for (const bound of field.notAfter ?? []) {
    const other = boundValue(field, bound, local, root);
    if (other !== null) candidatesMax.push(bound.sameDay ? other : step(other, -1));
  }
  const min = candidatesMin.length > 0 ? candidatesMin.sort().at(-1)! : null;
  const max = candidatesMax.length > 0 ? candidatesMax.sort()[0]! : null;
  return { min, max };
}

/** Shifts a "YYYY-MM" month forward/backward. */
function shiftMonth(value: string, months: number): string {
  const [y, m] = value.split("-").map(Number) as [number, number];
  const index = y * 12 + (m - 1) + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Normalization: reduces untrusted JSON to the shape in the definition
// ---------------------------------------------------------------------------

function normalizeScalar(field: ScalarField, raw: unknown): string {
  if (typeof raw !== "string" && typeof raw !== "number") return "";
  const value = String(raw);
  switch (field.type) {
    case "text": {
      const spaced = field.compact ? value.replace(/\s+/g, "") : value.replace(/\s+/g, " ").trim();
      const cased = field.uppercase ? spaced.toUpperCase() : spaced;
      return cased.slice(0, field.maxLength ?? DEFAULT_TEXT_MAX);
    }
    case "textarea":
      return value
        .replace(/\r\n?/g, "\n")
        .replace(/[^\S\n]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, field.maxLength ?? DEFAULT_TEXTAREA_MAX);
    case "select":
      return field.options.some((o) => o.value === value) ? value : "";
    case "yesno":
      return value === YES || value === NO ? value : "";
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
    case "month":
      // The field may previously have been asked as a full date (e.g. job start date); the month-year part is kept.
      return /^\d{4}-\d{2}(-\d{2})?$/.test(value) ? value.slice(0, 7) : "";
    case "money": {
      const trimmed = value.trim().slice(0, 24);
      return parseMoney(trimmed) ?? trimmed;
    }
    case "phone":
      return value.trim().slice(0, 25);
    case "email":
      return value.trim().toLowerCase().slice(0, 254);
    case "nationalId":
      return normalizeNationalId(value.trim()).slice(0, 15);
  }
}

function normalizeFields(fields: readonly Field[], raw: unknown): Obj {
  const source = isObj(raw) ? raw : {};
  const result: Obj = {};
  for (const field of fields) {
    const value = source[field.key];
    if (field.type === "group") {
      result[field.key] = normalizeFields(field.fields, value);
    } else if (field.type === "repeat") {
      const items = Array.isArray(value) ? value.slice(0, field.max) : [];
      result[field.key] = items.map((item) => normalizeFields(field.fields, item));
    } else {
      result[field.key] = normalizeScalar(field, value);
    }
  }
  return result;
}

/** Cleans raw data from the client or the database according to the section definition. */
export function normalizeSectionData(section: Section, raw: unknown): SectionData {
  return normalizeFields(section.fields, raw);
}

/** Builds complete form data (missing parts filled with empty values) from the section records in the database. */
export function buildFormData(rows: ReadonlyArray<{ section_id: string; data: unknown }>): FormData {
  const result: FormData = {};
  for (const section of FORM_SECTIONS) {
    const row = rows.find((r) => r.section_id === section.id);
    result[section.id] = normalizeSectionData(section, row?.data);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Clearing hidden fields
// ---------------------------------------------------------------------------

function pruneFields(fields: readonly Field[], data: Obj, root: FormData): Obj {
  const result: Obj = {};
  for (const field of fields) {
    const visible = isFieldVisible(field, data, root);
    const value = data[field.key];
    if (field.type === "group") {
      result[field.key] = visible
        ? pruneFields(field.fields, isObj(value) ? value : {}, root)
        : normalizeFields(field.fields, {});
    } else if (field.type === "repeat") {
      const items = visible && Array.isArray(value) ? value : [];
      result[field.key] = items.map((item) => pruneFields(field.fields, isObj(item) ? item : {}, root));
    } else {
      result[field.key] = visible && typeof value === "string" ? value : "";
    }
  }
  return result;
}

/**
 * Deletes old answers of fields hidden because their condition is not met.
 * PDF output, the summary and pre-submission validation always use this cleaned data.
 */
export function pruneFormData(formData: FormData): FormData {
  const result: FormData = {};
  for (const section of FORM_SECTIONS) {
    result[section.id] = pruneFields(section.fields, normalizeSectionData(section, formData[section.id]), formData);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const REQUIRED_MESSAGE: Partial<Record<ScalarField["type"], string>> = {
  yesno: "Lütfen Evet veya Hayır seçiniz.",
  select: "Lütfen bir seçim yapınız.",
  date: "Lütfen bir tarih giriniz.",
  month: "Lütfen ay ve yıl seçiniz.",
};

function scalarSchema(field: ScalarField, today: string): z.ZodType<string> {
  switch (field.type) {
    case "text": {
      let schema = z.string().max(field.maxLength ?? DEFAULT_TEXT_MAX, "Bu alan çok uzun.");
      if (field.pattern) schema = schema.regex(field.pattern.regex, field.pattern.message);
      return schema;
    }
    case "textarea":
      return z.string().max(field.maxLength ?? DEFAULT_TEXTAREA_MAX, "Bu alan çok uzun.");
    case "select":
      return z.string().refine((v) => field.options.some((o) => o.value === v), "Lütfen listeden bir seçim yapınız.");
    case "yesno":
      return z.string().refine((v) => v === YES || v === NO, "Lütfen Evet veya Hayır seçiniz.");
    case "date": {
      const base = z.string().refine(isValidIsoDate, "Geçerli bir tarih giriniz.");
      if (field.range === "past") return base.refine((v) => v <= today, field.rangeMessage ?? "Bu tarih bugünden ileri olamaz.");
      if (field.range === "future") return base.refine((v) => v >= today, field.rangeMessage ?? "Bu tarih geçmişte olamaz.");
      return base;
    }
    case "month": {
      const base = z.string().refine(isValidIsoMonth, "Geçerli bir ay ve yıl seçiniz.");
      if (field.range === "past") return base.refine((v) => v <= today.slice(0, 7), field.rangeMessage ?? "Bu tarih bugünden ileri olamaz.");
      return base;
    }
    case "money":
      return z.string().refine((v) => parseMoney(v) !== null, "Geçerli bir tutar giriniz. Örnek: 45.000");
    case "phone":
      return z.string().refine(isValidPhone, "Geçerli bir telefon numarası giriniz. Türkiye için örnek: 532 123 45 67 (başında 0 olmadan).");
    case "email":
      return z.string().refine(isValidEmail, "Geçerli bir e-posta adresi giriniz.");
    case "nationalId":
      return z
        .string()
        .regex(/^[0-9]{11}$/, "T.C. kimlik numarası 11 rakamdan oluşmalıdır.")
        .refine(isValidNationalId, "T.C. kimlik numarası geçersiz. Lütfen kontrol ediniz.");
  }
}

function validateFields(
  fields: readonly Field[],
  data: Obj,
  root: FormData,
  today: string,
  prefix: string,
  errors: FieldErrors,
): void {
  for (const field of fields) {
    if (!isFieldVisible(field, data, root)) continue;
    const path = prefix ? `${prefix}.${field.key}` : field.key;
    const value = data[field.key];

    if (field.type === "group") {
      validateFields(field.fields, isObj(value) ? value : {}, root, today, path, errors);
      continue;
    }

    if (field.type === "repeat") {
      const items = Array.isArray(value) ? value : [];
      const limits = repeatLimits(field, data, root);
      if (items.length < limits.min) {
        errors[path] = limits.min === 1 ? "En az bir kayıt eklemelisiniz." : `En az ${limits.min} kayıt eklemelisiniz.`;
      } else if (items.length > limits.max) {
        errors[path] =
          limits.max === 1 ? "Yalnızca bir kayıt girebilirsiniz; fazla kaydı siliniz." : `En fazla ${limits.max} kayıt girebilirsiniz; fazla kayıtları siliniz.`;
      }
      items.forEach((item, index) => {
        validateFields(field.fields, isObj(item) ? item : {}, root, today, `${path}.${index}`, errors);
      });
      continue;
    }

    const text = typeof value === "string" ? value : "";
    if (text === "") {
      if (field.required) errors[path] = REQUIRED_MESSAGE[field.type] ?? "Bu alan zorunludur.";
      continue;
    }
    const parsed = scalarSchema(field, today).safeParse(text);
    if (!parsed.success) {
      errors[path] = parsed.error.issues[0]?.message ?? "Geçersiz değer.";
      continue;
    }
    const bounds = field.type === "date" || field.type === "month" ? dateBoundsError(field, text, data, root, today) : null;
    if (bounds) {
      errors[path] = bounds;
      continue;
    }
    const custom = field.validate?.(text, { local: data, root, today });
    if (custom) errors[path] = custom;
  }
}

/** Validates the visible fields of a section. The section is valid if the returned object is empty. */
export function validateSection(
  section: Section,
  data: SectionData,
  root: FormData,
  today: string = todayInIstanbul(),
): FieldErrors {
  const errors: FieldErrors = {};
  validateFields(section.fields, data, root, today, "", errors);
  return errors;
}

function countRequired(fields: readonly Field[], data: Obj, root: FormData, count: { filled: number; total: number }): void {
  for (const field of fields) {
    if (!isFieldVisible(field, data, root)) continue;
    const value = data[field.key];
    if (field.type === "group") {
      countRequired(field.fields, isObj(value) ? value : {}, root, count);
    } else if (field.type === "repeat") {
      for (const item of Array.isArray(value) ? value : []) countRequired(field.fields, isObj(item) ? item : {}, root, count);
    } else if (field.required) {
      count.total += 1;
      // As in validation: non-empty text counts as "filled" (even if its format is wrong; the error is shown separately).
      if (typeof value === "string" && value !== "") count.filled += 1;
    }
  }
}

/**
 * How many of the section's visible required fields are filled ("n / m zorunlu alan dolduruldu" in the form's bottom bar).
 * Hidden conditional fields are not counted; for repeated entries each entry's required fields are counted separately.
 */
export function countRequiredFields(section: Section, data: SectionData, root: FormData): { filled: number; total: number } {
  const count = { filled: 0, total: 0 };
  countRequired(section.fields, data, root, count);
  return count;
}

function hasAnyValue(value: unknown): boolean {
  if (typeof value === "string") return value !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (isObj(value)) return Object.values(value).some(hasAnyValue);
  return false;
}

/**
 * Has the customer written at least one answer in the form? Only then does "Başvuru formu" show a yellow exclamation
 * (incomplete) in the step bar; a form that has not been started shows a grey number.
 */
export function formHasAnyAnswer(formData: FormData): boolean {
  return FORM_SECTIONS.some((section) => hasAnyValue(formData[section.id]));
}

export type FormValidationResult = {
  valid: boolean;
  sections: Record<SectionId, { status: SectionStatus; errorCount: number }>;
};

/** Validates the whole form (before submission). */
export function validateForm(formData: FormData, today: string = todayInIstanbul()): FormValidationResult {
  const sections = {} as FormValidationResult["sections"];
  let valid = true;
  for (const section of FORM_SECTIONS) {
    const data = formData[section.id] ?? {};
    const errors = validateSection(section, data, formData, today);
    const errorCount = Object.keys(errors).length;
    if (errorCount > 0) valid = false;
    sections[section.id] = {
      status: errorCount === 0 ? "complete" : hasAnyValue(data) ? "incomplete" : "empty",
      errorCount,
    };
  }
  return { valid, sections };
}

// ---------------------------------------------------------------------------
// Display (summary screen and admin panel)
// ---------------------------------------------------------------------------

export function formatScalarValue(field: ScalarField, value: string): string {
  if (value === "") return "";
  switch (field.type) {
    case "select":
      return field.options.find((o) => o.value === value)?.label ?? value;
    case "yesno":
      return value === YES ? "Evet" : value === NO ? "Hayır" : value;
    case "date":
      return formatDateTr(value);
    case "month":
      return formatMonthTr(value);
    case "money": {
      const parsed = parseMoney(value);
      return parsed === null ? value : `${formatMoneyTr(parsed)} TL`;
    }
    default:
      return value;
  }
}

export type DisplayNode =
  | { kind: "value"; key: string; label: string; value: string; multiline: boolean }
  | { kind: "group"; key: string; label: string; children: DisplayNode[] }
  | { kind: "list"; key: string; label: string; items: { label: string; children: DisplayNode[] }[] };

function displayFields(fields: readonly Field[], data: Obj, root: FormData, prefix: string): DisplayNode[] {
  const nodes: DisplayNode[] = [];
  for (const field of fields) {
    if (!isFieldVisible(field, data, root)) continue;
    const key = prefix ? `${prefix}.${field.key}` : field.key;
    const value = data[field.key];
    if (field.type === "group") {
      nodes.push({
        kind: "group",
        key,
        label: field.label,
        children: displayFields(field.fields, isObj(value) ? value : {}, root, key),
      });
    } else if (field.type === "repeat") {
      const items = Array.isArray(value) ? value : [];
      nodes.push({
        kind: "list",
        key,
        label: field.label,
        items: items.map((item, index) => ({
          label: `${field.itemLabel} ${index + 1}`,
          children: displayFields(field.fields, isObj(item) ? item : {}, root, `${key}.${index}`),
        })),
      });
    } else {
      nodes.push({
        kind: "value",
        key,
        label: field.label,
        value: formatScalarValue(field, typeof value === "string" ? value : ""),
        multiline: field.type === "textarea",
      });
    }
  }
  return nodes;
}

/** Returns only the visible fields of a section with their formatted values. */
export function buildSectionDisplay(section: Section, formData: FormData): DisplayNode[] {
  return displayFields(section.fields, formData[section.id] ?? {}, formData, "");
}

/** Empty entry to add to a repeat field. */
export function emptyRepeatItem(field: RepeatField): Obj {
  return normalizeFields(field.fields, {});
}

function ensureMinimums(fields: readonly Field[], data: Obj, root: FormData): Obj {
  let result = data;
  for (const field of fields) {
    if (field.type !== "group" && field.type !== "repeat") continue;
    if (!isFieldVisible(field, data, root)) continue;
    const value = data[field.key];
    if (field.type === "group") {
      const current = isObj(value) ? value : {};
      const next = ensureMinimums(field.fields, current, root);
      if (next !== current || !isObj(value)) result = { ...result, [field.key]: next };
    } else if (field.type === "repeat") {
      const current = Array.isArray(value) ? value : [];
      let items = current.map((item) => ensureMinimums(field.fields, isObj(item) ? item : {}, root));
      const changed = items.some((item, i) => item !== current[i]);
      const { min } = repeatLimits(field, data, root);
      if (items.length < min) {
        items = [...items, ...Array.from({ length: min - items.length }, () => emptyRepeatItem(field))];
        result = { ...result, [field.key]: items };
      } else if (changed) {
        result = { ...result, [field.key]: items };
      }
    }
  }
  return result;
}

/**
 * Adds the minimum number of empty entries to repeat fields that become visible
 * (e.g. choosing "Evet" (yes) for "do you have children?" opens the first entry form right away).
 */
export function ensureRepeatMinimums(section: Section, data: SectionData, root: FormData): SectionData {
  return ensureMinimums(section.fields, data, { ...root, [section.id]: data });
}

function trimMaximums(fields: readonly Field[], data: Obj, root: FormData, prefix: string, trimmed: string[]): Obj {
  let result = data;
  for (const field of fields) {
    if (field.type !== "group" && field.type !== "repeat") continue;
    if (!isFieldVisible(field, data, root)) continue;
    const path = prefix ? `${prefix}.${field.key}` : field.key;
    const value = data[field.key];
    if (field.type === "group") {
      if (!isObj(value)) continue;
      const next = trimMaximums(field.fields, value, root, path, trimmed);
      if (next !== value) result = { ...result, [field.key]: next };
      continue;
    }
    if (!Array.isArray(value)) continue;
    const { max } = repeatLimits(field, data, root);
    let items = value.map((item, index) => (isObj(item) ? trimMaximums(field.fields, item, root, `${path}.${index}`, trimmed) : item));
    const changed = items.some((item, i) => item !== value[i]);
    if (items.length > max) {
      items = items.slice(0, max);
      trimmed.push(path);
      result = { ...result, [field.key]: items };
    } else if (changed) {
      result = { ...result, [field.key]: items };
    }
  }
  return result;
}

/**
 * When the answer-dependent number of entries goes down the extra entries are removed; the first ones stay. Answers to
 * hidden questions are cleared the same way (pruneFormData). Paths of lists that lost entries are returned; the UI
 * tells the user.
 */
export function trimRepeatMaximums(section: Section, data: SectionData, root: FormData): { data: SectionData; trimmed: string[] } {
  const trimmed: string[] = [];
  const next = trimMaximums(section.fields, data, { ...root, [section.id]: data }, "", trimmed);
  return { data: next, trimmed };
}

/** Returns a new copy of the data with the value at the dot-separated path changed. */
export function setAtPath(data: SectionData, path: string, value: unknown): SectionData {
  const parts = path.split(".");
  const assign = (node: unknown, index: number): unknown => {
    const key = parts[index]!;
    const last = index === parts.length - 1;
    if (Array.isArray(node)) {
      const copy = node.slice();
      const i = Number(key);
      copy[i] = last ? value : assign(copy[i], index + 1);
      return copy;
    }
    const source = isObj(node) ? node : {};
    return { ...source, [key]: last ? value : assign(source[key], index + 1) };
  };
  return assign(data, 0) as SectionData;
}

export function getAtPath(data: SectionData, path: string): unknown {
  let current: unknown = data;
  for (const part of path.split(".")) {
    if (Array.isArray(current)) current = current[Number(part)];
    else if (isObj(current)) current = current[part];
    else return undefined;
  }
  return current;
}
