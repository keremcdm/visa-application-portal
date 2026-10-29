/**
 * Types for the declarative definition of the application form.
 *
 * The form is defined in a single place (definition.ts); the UI, validation, summary screen,
 * admin panel view and PDF output all use this definition.
 */

export type FieldOption = { value: string; label: string };

/** Visibility condition of a field. Without `scope` it is evaluated against the nearest containing object. */
export type Condition =
  | { path: string; scope?: "local" | "root"; equals: string }
  | { path: string; scope?: "local" | "root"; in: readonly string[] }
  | { all: readonly Condition[] }
  | { any: readonly Condition[] };

type BaseField = {
  /** Key inside the containing object. */
  key: string;
  label: string;
  hint?: string;
  required?: boolean;
  visibleWhen?: Condition;
  /** Should it take half the width on desktop? Default: depends on the field type. */
  width?: "full" | "half";
};

export type ScalarValidator = (value: string, ctx: ValidationContext) => string | null;

export type ValidationContext = {
  /** The object containing the field (section, group or repeat item). */
  local: Record<string, unknown>;
  /** Data of all sections. */
  root: FormData;
  /** Today's date (YYYY-MM-DD, Europe/Istanbul). Can be pinned in tests. */
  today: string;
};

type ScalarBase = BaseField & { validate?: ScalarValidator };

export type TextField = ScalarBase & {
  type: "text";
  maxLength?: number;
  autoComplete?: string;
  /** Convert to upper case when saving (e.g. passport number, postcode)? */
  uppercase?: boolean;
  /** Remove all whitespace when saving (e.g. passport number)? */
  compact?: boolean;
  pattern?: { regex: RegExp; message: string };
  /** Sample text shown in grey while the field is empty; disappears once typing starts. */
  placeholder?: string;
};
export type TextareaField = ScalarBase & {
  type: "textarea";
  maxLength?: number;
  rows?: number;
  /** Sample text shown in grey while the field is empty; disappears once typing starts. */
  placeholder?: string;
};
export type SelectField = ScalarBase & { type: "select"; options: readonly FieldOption[] };
export type YesNoField = ScalarBase & { type: "yesno" };
/**
 * Limit of a date relative to another date (e.g. the return date cannot be before the departure date). Used in validation;
 * the date picker also shows days outside the limit as unselectable. No limit is applied if `path` is empty.
 */
export type DateBound = {
  path: string;
  scope?: "local" | "root";
  /** Is the same day (the same month for a month-year field) accepted? */
  sameDay?: boolean;
  message: string;
};

type DateRules = {
  /** Cannot be before these date(s). */
  notBefore?: readonly DateBound[];
  /** Cannot be after these date(s). */
  notAfter?: readonly DateBound[];
  /** At most this many years back from today (e.g. "in the last 10 years" questions). */
  withinYears?: number;
  /** Custom message shown when `range` is violated. */
  rangeMessage?: string;
};

export type DateField = ScalarBase & DateRules & { type: "date"; range?: "past" | "future" | "any" };
/** Month-year selection; stored as "YYYY-MM". */
export type MonthField = ScalarBase & DateRules & { type: "month"; range?: "past" | "any" };
export type MoneyField = ScalarBase & { type: "money" };
export type PhoneField = ScalarBase & { type: "phone" };
export type EmailField = ScalarBase & { type: "email" };
export type NationalIdField = ScalarBase & { type: "nationalId" };

export type ScalarField =
  | TextField
  | TextareaField
  | SelectField
  | YesNoField
  | DateField
  | MonthField
  | MoneyField
  | PhoneField
  | EmailField
  | NationalIdField;

/** Nested object (e.g. spouse details). */
export type GroupField = BaseField & { type: "group"; fields: readonly Field[] };

/** Repeatable list of entries (e.g. children, trips). */
export type RepeatField = BaseField & {
  type: "repeat";
  itemLabel: string;
  addLabel: string;
  min: number;
  /** Absolute maximum (stored data is truncated to this number). */
  max: number;
  /**
   * If the number of entries depends on another question's answer (e.g. "how many times have you been?" → a single entry for
   * "Bir defa"): minimum / maximum entries per answer. For an answer not in the list, `min` / `max` apply.
   */
  countBy?: { path: string; scope?: "local" | "root"; limits: Readonly<Record<string, { min: number; max: number }>> };
  fields: readonly Field[];
};

export type Field = ScalarField | GroupField | RepeatField;

export type SectionId =
  | "personal"
  | "contact"
  | "passport"
  | "employment"
  | "travel"
  | "family"
  | "history"
  | "security"
  | "additional";

export type Section = {
  id: SectionId;
  /** Section name: used as is in the progress tiles and the page title. */
  title: string;
  fields: readonly Field[];
};

export type SectionData = Record<string, unknown>;
export type FormData = Partial<Record<SectionId, SectionData>>;

/** Error map: a path such as "previousAddresses.0.address" -> Turkish message. */
export type FieldErrors = Record<string, string>;

export type SectionStatus = "empty" | "incomplete" | "complete";
