/**
 * UNSAVED CHANGES (admin panel, a single "Kaydet")
 *
 * The user-modified version of each row in a tab is kept as a "draft"; it overrides the value from the server.
 * An unsaved change is a row whose draft differs from the value it is compared with.
 * There is no autosave: drafts only go to the server with "Kaydet".
 */

export type DraftValue = string | number | boolean | null;
export type DraftRow = Readonly<Record<string, DraftValue>>;

/** Row id → draft. */
export type Drafts<T extends DraftRow> = Readonly<Record<string, T>>;

export function sameValues(a: DraftRow, b: DraftRow): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!Object.is(a[key], b[key])) return false;
  }
  return true;
}

/**
 * Ids of the rows whose draft differs from the value it is compared with, in draft order.
 * A row without a counterpart (e.g. deleted in the meantime) does not count as a change.
 */
export function changedKeys<T extends DraftRow>(drafts: Drafts<T>, base: (key: string) => T | undefined): string[] {
  return Object.keys(drafts).filter((key) => {
    const reference = base(key);
    return reference !== undefined && !sameValues(drafts[key]!, reference);
  });
}

/** Drops drafts that no longer carry a change (value equal to its counterpart, or row gone). */
export function pruneDrafts<T extends DraftRow>(drafts: Drafts<T>, base: (key: string) => T | undefined): Drafts<T> {
  const kept = changedKeys(drafts, base);
  if (kept.length === Object.keys(drafts).length) return drafts;
  return Object.fromEntries(kept.map((key) => [key, drafts[key]!]));
}

/** Drops the drafts of the given rows (e.g. those saved). */
export function withoutDrafts<T extends DraftRow>(drafts: Drafts<T>, keys: Iterable<string>): Drafts<T> {
  const remove = new Set(keys);
  return Object.fromEntries(Object.entries(drafts).filter(([key]) => !remove.has(key)));
}

// ---------------------------------------------------------------------------
// Row errors from a batch save
// ---------------------------------------------------------------------------
//
// Batch save actions return errors in ActionResult.fieldErrors keyed by row id:
//   "<row>.<field>"  validation error. If there is a validation error, NO row has been written.
//   "<row>"          that row could not be written to the database; the other rows without an error key were written.
// Row ids (uuid, a new row like "new-1", document type id) contain no dots.

export function rowFieldErrorKey(row: string, field: string): string {
  return `${row}.${field}`;
}

/** A row's error messages: field errors and (if it could not be written) the row error. */
export function errorsOfRow(fieldErrors: Readonly<Record<string, string>> | undefined, row: string): { fields: Record<string, string>; row: string | null } {
  const fields: Record<string, string> = {};
  let rowError: string | null = null;
  for (const [key, message] of Object.entries(fieldErrors ?? {})) {
    if (key === row) rowError = message;
    else if (key.startsWith(`${row}.`)) fields[key.slice(row.length + 1)] = message;
  }
  return { fields, row: rowError };
}

/** Drops all errors of a row; returns the same object if the row has no errors. */
export function withoutRowErrors(fieldErrors: Readonly<Record<string, string>>, row: string): Readonly<Record<string, string>> {
  const kept = Object.entries(fieldErrors).filter(([key]) => key !== row && !key.startsWith(`${row}.`));
  return kept.length === Object.keys(fieldErrors).length ? fieldErrors : Object.fromEntries(kept);
}

/**
 * After a failed batch save, which of the sent rows were saved anyway.
 * None on a validation error; on a write error all those without an error key were saved.
 */
export function savedDespiteFailure(sent: readonly string[], fieldErrors: Readonly<Record<string, string>> | undefined): string[] {
  const keys = Object.keys(fieldErrors ?? {});
  if (keys.length === 0 || keys.some((key) => key.includes("."))) return [];
  const failed = new Set(keys);
  return sent.filter((row) => !failed.has(row));
}

// ---------------------------------------------------------------------------
// Shape of a batch save request (server side, untrusted input)
// ---------------------------------------------------------------------------

/** Ids of new, not yet saved rows opened with the "Ekle" (add) button: "new-1", "new-2" … */
const NEW_ROW_PATTERN = /^new-[0-9]{1,6}$/;

export function newRowKey(n: number): string {
  return `new-${n}`;
}

export function isNewRowKey(key: string): boolean {
  return NEW_ROW_PATTERN.test(key);
}

export type BatchInput = { updates: { id: string; values: unknown }[]; creates: { key: string; values: unknown }[] };

function parseRows(value: unknown, isValidKey: (key: string) => boolean, keyName: "id" | "key", seen: Set<string>): { key: string; values: unknown }[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const rows: { key: string; values: unknown }[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const key = record[keyName];
    if (typeof key !== "string" || key.includes(".") || !isValidKey(key) || seen.has(key)) return null;
    seen.add(key);
    rows.push({ key, values: record.values });
  }
  return rows;
}

/**
 * Checks the `{ updates: [{ id, values }], creates: [{ key, values }] }` shape. The values themselves are not validated here.
 * Returns null if the shape is broken, an id is invalid or repeated, or the row count exceeds the limit.
 */
export function parseBatchInput(input: unknown, isValidId: (id: string) => boolean, maxRows: number): BatchInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const { updates, creates } = input as Record<string, unknown>;
  const seen = new Set<string>();
  const parsedUpdates = parseRows(updates ?? [], (id) => !isNewRowKey(id) && isValidId(id), "id", seen);
  const parsedCreates = parseRows(creates, isNewRowKey, "key", seen);
  if (!parsedUpdates || !parsedCreates) return null;
  if (parsedUpdates.length + parsedCreates.length > maxRows) return null;
  return { updates: parsedUpdates.map(({ key, values }) => ({ id: key, values })), creates: parsedCreates };
}
