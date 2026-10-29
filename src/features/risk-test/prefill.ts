import { FORM_SECTIONS, getSection, NO, YES } from "@/features/application-form/definition";
import { formatScalarValue, getAtPath, isFieldVisible, setAtPath } from "@/features/application-form/engine";
import type { Field, FormData, ScalarField, SectionData, SectionId } from "@/features/application-form/types";
import { Q } from "./definition";

/**
 * SUGGESTED values for the application form from the risk assessment answers (pure functions).
 *
 * Only fields where the test answer determines the form answer with certainty are mapped; no field is filled until the customer
 * accepts the suggestion, and a filled field is never overwritten.
 * The customer is asked a SINGLE confirmation for the whole form; if accepted, all sections are filled together.
 *
 * Deliberately not mapped: income range (the form asks for an exact amount), employment status (the form asks for occupation/title
 * as free text), "UK vizesi aldım" (whether it was within the last 10 years is unknown), "UK'den hiç reddedilmedim"
 * (the form also asks about deportation and removal), "birinci dereceden akrabam yok" (the form asks about a broader
 * definition of relatives).
 */

export type PrefillValue = { sectionId: SectionId; path: string; value: string };

/** What the test's relative status options map to in the form's "Statüsü" (status) field. */
const UK_RELATIVE_STATUS_TEXT: Record<number, string> = {
  1: "Geçici oturum izni",
  2: "Kalıcı oturum",
  3: "İngiliz vatandaşı",
};

/** `answers` must be a complete array that went through normalizeRiskAnswers. */
export function buildRiskPrefill(answers: readonly number[]): PrefillValue[] {
  const values: PrefillValue[] = [];
  const add = (sectionId: SectionId, path: string, value: string) => values.push({ sectionId, path, value });

  const marital = answers[Q.maritalStatus];
  if (marital === 0) add("personal", "maritalStatus", "single");
  if (marital === 1 || marital === 2) add("personal", "maritalStatus", "married");
  if (marital === 2) add("family", "hasDependents", YES);

  add("employment", "hasSavings", answers[Q.savings] === 0 ? NO : YES);

  if (answers[Q.ukVisa] === 0) add("history", "hadUkVisaLast10Years", NO);

  // If "Hiç yurt dışı seyahatim olmadı" (never travelled abroad) and "başka ülkelere seyahat ettim" (travelled to other countries)
  // are given together the answers contradict each other; then no suggestion is made for the travel history.
  const neverTravelled = answers[Q.ruleCompliance] === 0;
  const travelledElsewhere = answers[Q.otherTravel] === 1 || answers[Q.otherTravel] === 2;
  if (neverTravelled && !travelledElsewhere) {
    add("history", "ukVisitCount", "none");
    add("history", "otherCountriesVisitCount", "none");
    add("history", "visitedElsewhere", NO);
  } else if (travelledElsewhere && !neverTravelled) {
    add("history", "visitedElsewhere", YES);
  }

  // The number of refusals is not a separate field (the customer writes it in the explanation); only the "I was refused" answer is filled.
  if (answers[Q.ukRefusal] === 1 || answers[Q.ukRefusal] === 2) add("security", "ukRefusal", YES);

  if (answers[Q.ukRelative] === 1) {
    add("family", "hasUkRelative", YES);
    const status = UK_RELATIVE_STATUS_TEXT[answers[Q.ukRelativeStatus] ?? -1];
    if (status) add("family", "ukRelative.status", status);
  }

  return values;
}

type Located = { field: ScalarField; labels: string[] };

/** Finds the field a path points to in the section definition (only paths within groups; repeated entries are not supported). */
function locate(sectionId: SectionId, path: string): Located | null {
  let fields: readonly Field[] = getSection(sectionId).fields;
  const labels: string[] = [];
  const parts = path.split(".");
  for (let i = 0; i < parts.length; i++) {
    const field = fields.find((f) => f.key === parts[i]);
    if (!field) return null;
    labels.push(field.label);
    if (i === parts.length - 1) return field.type === "group" || field.type === "repeat" ? null : { field, labels };
    if (field.type !== "group") return null;
    fields = field.fields;
  }
  return null;
}

/** Is every step of the path (including groups) visible in the given data? */
function isPathVisible(sectionId: SectionId, data: SectionData, path: string, root: FormData): boolean {
  let fields: readonly Field[] = getSection(sectionId).fields;
  let local: Record<string, unknown> = data;
  for (const key of path.split(".")) {
    const field = fields.find((f) => f.key === key);
    if (!field || !isFieldVisible(field, local, root)) return false;
    if (field.type === "group") {
      const value = local[field.key];
      local = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
      fields = field.fields;
    }
  }
  return true;
}

const isEmpty = (data: SectionData, path: string): boolean => {
  const current = getAtPath(data, path);
  return current === undefined || current === null || current === "";
};

/** Writes values only into EMPTY fields; filled fields are not touched. */
export function applyPrefill(data: SectionData, values: ReadonlyArray<Pick<PrefillValue, "path" | "value">>): SectionData {
  let next = data;
  for (const { path, value } of values) {
    if (isEmpty(next, path)) next = setAtPath(next, path, value);
  }
  return next;
}

/**
 * Suggestions still valid for a section: the field must be empty and visible after the suggestions are applied.
 * (Example: if the customer said "akrabam yok" (no relatives), the relative's status is not suggested.)
 */
export function pendingPrefill(sectionId: SectionId, data: SectionData, values: readonly PrefillValue[], root: FormData): PrefillValue[] {
  const candidates = values.filter((v) => v.sectionId === sectionId && locate(sectionId, v.path) !== null && isEmpty(data, v.path));
  const after = applyPrefill(data, candidates);
  const rootAfter = { ...root, [sectionId]: after };
  return candidates.filter((v) => isPathVisible(sectionId, after, v.path, rootAfter));
}

/**
 * Applies the suggestions to THE WHOLE form: in each section only fields that are empty and stay visible are filled.
 * Only changed sections are returned; `filled` is the number of fields filled.
 */
export function applyPrefillToForm(
  formData: FormData,
  values: readonly PrefillValue[],
): { sections: Partial<Record<SectionId, SectionData>>; filled: number } {
  let root = formData;
  const sections: Partial<Record<SectionId, SectionData>> = {};
  let filled = 0;
  for (const section of FORM_SECTIONS) {
    const data = root[section.id] ?? {};
    const pending = pendingPrefill(section.id, data, values, root);
    if (pending.length === 0) continue;
    const next = applyPrefill(data, pending);
    sections[section.id] = next;
    filled += pending.length;
    root = { ...root, [section.id]: next };
  }
  return { sections, filled };
}

export type PrefillSuggestion = { path: string; value: string; label: string; display: string };

export type PrefillGroup = { sectionId: SectionId; title: string; items: PrefillSuggestion[] };

/** Suggestions still valid for the whole form, per section (to be shown to the customer at once). */
export function pendingPrefillForForm(formData: FormData, values: readonly PrefillValue[]): PrefillGroup[] {
  const groups: PrefillGroup[] = [];
  for (const section of FORM_SECTIONS) {
    const items = describePrefill(pendingPrefill(section.id, formData[section.id] ?? {}, values, formData));
    if (items.length > 0) groups.push({ sectionId: section.id, title: section.title, items });
  }
  return groups;
}

/** Converts suggestions to the form shown to the customer (field label and formatted value). */
export function describePrefill(values: readonly PrefillValue[]): PrefillSuggestion[] {
  const suggestions: PrefillSuggestion[] = [];
  for (const { sectionId, path, value } of values) {
    const located = locate(sectionId, path);
    if (!located) continue;
    suggestions.push({ path, value, label: located.labels.join(" → "), display: formatScalarValue(located.field, value) });
  }
  return suggestions;
}
