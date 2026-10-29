"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { WizardBody, WizardFooter, WizButton, wizButtonClass, WizField as FieldShell, WizNote } from "@/components/customer/wizard/ui";
import { DateInput } from "@/components/ui/date-input";
import { describedBy, Input, Select, Textarea } from "@/components/ui/form";
import { isOffline, OFFLINE_MESSAGE, UNREACHABLE_MESSAGE, useOnline } from "@/components/ui/network";
import { cn } from "@/components/ui/primitives";
import { getSection, NO, YES } from "@/features/application-form/definition";
import {
  countRequiredFields,
  dateLimits,
  emptyRepeatItem,
  ensureRepeatMinimums,
  isFieldVisible,
  repeatLimits,
  setAtPath,
  trimRepeatMaximums,
  validateSection,
} from "@/features/application-form/engine";
import { getFieldHelp } from "@/features/application-form/help";
import type { Field, FieldErrors, FormData, RepeatField, ScalarField, SectionData, SectionId } from "@/features/application-form/types";
import { applyPrefill, type PrefillGroup } from "@/features/risk-test/prefill";
import { applyRiskPrefillAction, saveFormSectionAction } from "@/server/actions/applications";
import { FieldHelpButton } from "./field-help";
import { PhoneInput } from "./phone-input";
import { useReportSaveStatus, type SaveStatus } from "./save-status";

type Obj = Record<string, unknown>;

type SaveState = SaveStatus;

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const AUTOSAVE_DELAY_MS = 1500;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const idFor = (path: string) => `f-${path.replace(/\./g, "-")}`;
/** For useSyncExternalStore: the stored flag does not change from outside while the page is open; there is no event to listen to. */
const subscribeToNothing = () => () => undefined;

function MonthInput({
  id,
  value,
  onChange,
  invalid,
  describedById,
  today,
  min,
  max,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  describedById?: string;
  today: string;
  /** Earliest / latest selectable month ("YYYY-MM"); comes from the date rules. */
  min: string | null;
  max: string | null;
}) {
  const [initialYear, initialMonth] = /^\d{4}-\d{2}$/.test(value) ? value.split("-") : ["", ""];
  // With only the month or only the year selected the value is not valid yet; the parent is notified once both are selected.
  const [year, setYear] = useState(initialYear ?? "");
  const [month, setMonth] = useState(initialMonth ?? "");
  const lastYear = max ? Number(max.slice(0, 4)) : Number(today.slice(0, 4));
  const firstYear = Math.min(lastYear, min ? Number(min.slice(0, 4)) : 1940);
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => String(lastYear - i));
  // Months that break the rule (e.g. end before start) cannot be selected in the list.
  const monthAllowed = (m: string) => !year || ((!min || `${year}-${m}` >= min) && (!max || `${year}-${m}` <= max));

  const emit = (nextYear: string, nextMonth: string) => {
    setYear(nextYear);
    setMonth(nextMonth);
    onChange(nextYear && nextMonth ? `${nextYear}-${nextMonth}` : "");
  };

  return (
    <div className="grid grid-cols-2 gap-3" role="group" aria-describedby={describedById}>
      <Select id={`${id}-month`} aria-label="Ay" value={month} aria-invalid={invalid || undefined} onChange={(e) => emit(year, e.target.value)}>
        <option value="">Ay</option>
        {MONTHS.map((name, i) => {
          const m = String(i + 1).padStart(2, "0");
          return (
            <option key={name} value={m} disabled={!monthAllowed(m)}>
              {name}
            </option>
          );
        })}
      </Select>
      <Select id={`${id}-year`} aria-label="Yıl" value={year} aria-invalid={invalid || undefined} onChange={(e) => emit(e.target.value, month)}>
        <option value="">Yıl</option>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </Select>
    </div>
  );
}

function YesNoInput({
  id,
  name,
  label,
  value,
  onChange,
  invalid,
  describedById,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  describedById?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} aria-describedby={describedById} aria-invalid={invalid || undefined} className="flex gap-3">
      {[
        { v: YES, label: "Evet" },
        { v: NO, label: "Hayır" },
      ].map((option) => (
        <label
          key={option.v}
          className={cn(
            "flex h-[50px] min-w-28 cursor-pointer items-center gap-3 rounded-[14px] border-[1.5px] px-4 text-[15px] font-semibold text-dash-navy transition-colors motion-reduce:transition-none",
            value === option.v
              ? "border-dash-navy bg-dash-selected"
              : invalid && value === ""
                ? "border-dash-red bg-white"
                : "border-dash-field bg-white hover:border-dash-check",
          )}
        >
          <input
            type="radio"
            id={`${id}-${option.v}`}
            name={name}
            value={option.v}
            checked={value === option.v}
            onChange={() => onChange(option.v)}
            className="wiz-radio"
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}

export function SectionForm({
  applicationId,
  sectionId,
  initialData,
  rootData,
  today,
  availableHelpImages,
  prefill = [],
  prevHref,
  nextHref,
  nextLabel,
}: {
  applicationId: string;
  sectionId: SectionId;
  initialData: SectionData;
  rootData: FormData;
  today: string;
  availableHelpImages: readonly string[];
  /** Suggestions prepared for THE WHOLE FORM from the risk assessment answers (per section); empty if none. */
  prefill?: readonly PrefillGroup[];
  prevHref: string | null;
  nextHref: string;
  nextLabel: string;
}) {
  const section = getSection(sectionId);
  const router = useRouter();

  // The suggestion box is asked ONCE for the whole form. If the customer says "Hayır" (no) it is not asked again for this
  // application (only in this browser; the only thing stored is a flag, never answers or personal data).
  const prefillKey = `vbp:prefill-declined:${applicationId}`;
  // null (unknown) on the server and on first render; the stored flag is read in the browser.
  const dismissedBefore = useSyncExternalStore<boolean | null>(
    subscribeToNothing,
    () => {
      try {
        return window.localStorage.getItem(prefillKey) === "1";
      } catch {
        // If the browser does not allow storage, the suggestion is shown every time.
        return false;
      }
    },
    () => null,
  );
  const [prefillChoice, setPrefillChoice] = useState<"applied" | "closed" | null>(null);
  const [prefillBusy, setPrefillBusy] = useState(false);
  const [prefillError, setPrefillError] = useState<string | null>(null);
  const [prefillFilled, setPrefillFilled] = useState(0);
  // The "applied" state is checked first so the thank-you message shows even if the server returns an empty list after filling.
  const prefillState: "checking" | "offered" | "applied" | "closed" =
    prefillChoice ?? (prefill.length === 0 ? "closed" : dismissedBefore === null ? "checking" : dismissedBefore ? "closed" : "offered");

  const [data, setData] = useState<SectionData>(() => ensureRepeatMinimums(section, initialData, rootData));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [showErrors, setShowErrors] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [navigating, setNavigating] = useState(false);
  // Notice independent of saving (e.g. could not move to the next page while offline); shown in the form's bottom bar.
  const [notice, setNotice] = useState<string | null>(null);
  // Repeat lists whose extra entries were removed after an answer changed (e.g. extra trips once "Bir defa" (once) is chosen).
  const [trimmedLists, setTrimmedLists] = useState<string[]>([]);
  const online = useOnline();
  // The save state is shown in the indicator in the page header.
  useReportSaveStatus(saveState);

  const dataRef = useRef(data);
  const versionRef = useRef(0);
  const savedVersionRef = useRef(0);
  const inflightRef = useRef<Promise<unknown> | null>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  const rootWith = useCallback((current: SectionData): FormData => ({ ...rootData, [sectionId]: current }), [rootData, sectionId]);

  /** Saves to the server. Only one save request runs at a time; the latest data is sent. */
  const persist = useCallback(async (): Promise<{ ok: true } | { ok: false; message: string }> => {
    if (inflightRef.current) await inflightRef.current.catch(() => undefined);
    const version = versionRef.current;
    if (version === savedVersionRef.current) return { ok: true };
    // While offline nothing is sent to the server; changes stay on the page and are saved when the connection returns.
    if (isOffline()) {
      setSaveState({ kind: "error", message: OFFLINE_MESSAGE });
      return { ok: false, message: OFFLINE_MESSAGE };
    }

    setSaveState({ kind: "saving" });
    const request = saveFormSectionAction(applicationId, sectionId, dataRef.current);
    inflightRef.current = request;
    let result: Awaited<typeof request>;
    try {
      result = await request;
    } catch {
      result = { ok: false, message: isOffline() ? OFFLINE_MESSAGE : UNREACHABLE_MESSAGE };
    } finally {
      inflightRef.current = null;
    }

    if (!result.ok) {
      setSaveState({ kind: "error", message: result.message });
      return { ok: false, message: result.message };
    }
    savedVersionRef.current = version;
    // If a new change was made while saving, the state stays "unsaved".
    setSaveState(
      versionRef.current === version
        ? { kind: "saved", at: new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) }
        : { kind: "dirty" },
    );
    return { ok: true };
  }, [applicationId, sectionId]);

  // Autosave shortly after changes (waits while offline).
  useEffect(() => {
    if (saveState.kind !== "dirty" || !online) return;
    const timer = window.setTimeout(() => void persist(), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [saveState, data, persist, online]);

  // Unsaved changes are saved automatically when the connection comes back.
  useEffect(() => {
    if (online && versionRef.current !== savedVersionRef.current) void persist();
  }, [online, persist]);
  // The connection warning is only shown while offline; it disappears by itself when the connection returns.
  const visibleNotice = online ? null : notice;

  /** "Kaydet" (save) button: shows the result even when there are no changes. */
  const saveNow = async () => {
    setNotice(null);
    const hadChanges = versionRef.current !== savedVersionRef.current;
    const saved = await persist();
    if (!saved.ok || hadChanges) return;
    if (isOffline()) setNotice(OFFLINE_MESSAGE);
    else setSaveState({ kind: "saved", at: new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) });
  };

  // Warning when leaving the page with unsaved changes.
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (versionRef.current !== savedVersionRef.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const apply = (next: SectionData) => {
    // If the answer-dependent number of entries went down, the extra entries are removed and reported below the list.
    const trimmed = trimRepeatMaximums(section, next, rootData);
    if (trimmed.trimmed.length > 0) setTrimmedLists((current) => [...new Set([...current, ...trimmed.trimmed])]);
    const filled = ensureRepeatMinimums(section, trimmed.data, rootData);
    dataRef.current = filled;
    versionRef.current += 1;
    setData(filled);
    setSaveState({ kind: "dirty" });
    if (showErrors) setErrors(validateSection(section, filled, rootWith(filled), today));
  };

  const setValue = (path: string, value: unknown) => apply(setAtPath(dataRef.current, path, value));

  /**
   * Writes the suggestions to ALL sections of the form at once. Values are generated on the server from the stored test
   * answers; only empty fields are filled. The screen of the open section is updated with the same values.
   */
  const acceptPrefill = async () => {
    setPrefillBusy(true);
    setPrefillError(null);
    // If this section has unsaved changes they are saved first, so the server works with current data.
    const saved = await persist();
    if (!saved.ok) {
      setPrefillBusy(false);
      setPrefillError(saved.message);
      return;
    }
    let result: Awaited<ReturnType<typeof applyRiskPrefillAction>>;
    try {
      result = await applyRiskPrefillAction(applicationId);
    } catch {
      result = { ok: false, message: "Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyiniz." };
    }
    setPrefillBusy(false);
    if (!result.ok) {
      setPrefillError(result.message);
      return;
    }

    const ownItems = prefill.find((group) => group.sectionId === sectionId)?.items ?? [];
    if (ownItems.length > 0) {
      // The server filled this section too; the data on screen is updated with the same values. A change typed while the
      // action was running (not yet saved) is kept and sent with the regular autosave.
      const unsavedEdits = versionRef.current !== savedVersionRef.current;
      const merged = ensureRepeatMinimums(section, applyPrefill(dataRef.current, ownItems), rootData);
      dataRef.current = merged;
      setData(merged);
      if (unsavedEdits) {
        versionRef.current += 1;
        setSaveState({ kind: "dirty" });
      }
      if (showErrors) setErrors(validateSection(section, merged, rootWith(merged), today));
    }
    const filled = result.data?.filled ?? 0;
    setPrefillFilled(filled);
    // If all fields were filled by hand in the meantime there is nothing left to write; the box closes silently.
    setPrefillChoice(filled > 0 ? "applied" : "closed");
    // Completion marks in the section list are refreshed from the server.
    router.refresh();
  };

  const declinePrefill = () => {
    try {
      window.localStorage.setItem(prefillKey, "1");
    } catch {
      // If it cannot be stored, the suggestion is shown again next time.
    }
    setPrefillChoice("closed");
  };

  const focusFirstError = (found: FieldErrors) => {
    const first = Object.keys(found)[0];
    if (!first) return;
    const base = idFor(first);
    const element =
      document.getElementById(base) ?? document.getElementById(`${base}-${YES}`) ?? document.getElementById(`${base}-month`) ?? document.getElementById(`${base}-add`);
    if (element) {
      element.scrollIntoView({ block: "center" });
      element.focus({ preventScroll: true });
    } else {
      errorSummaryRef.current?.focus();
    }
  };

  const saveAndContinue = async () => {
    const found = validateSection(section, dataRef.current, rootWith(dataRef.current), today);
    setErrors(found);
    setShowErrors(true);
    setNavigating(true);
    setNotice(null);
    // Saved even if invalid: the customer never loses progress; missing items are checked again before submission.
    const saved = await persist();
    if (!saved.ok || Object.keys(found).length > 0) {
      setNavigating(false);
      // If saving fails, the error is also announced in the status line below (role="alert").
      focusFirstError(found);
      return;
    }
    // While offline the next page cannot load; stay on this page instead of landing on the browser's error page.
    if (isOffline()) {
      setNavigating(false);
      setNotice(`Sonraki adıma geçilemedi. ${OFFLINE_MESSAGE}`);
      return;
    }
    router.push(nextHref);
  };

  const errorCount = Object.keys(errors).length;
  const required = countRequiredFields(section, data, rootWith(data));

  const renderScalar = (field: ScalarField, path: string, local: Obj): ReactNode => {
    const id = idFor(path);
    const value = typeof local[field.key] === "string" ? (local[field.key] as string) : "";
    const error = showErrors ? errors[path] : undefined;
    const help = getFieldHelp(sectionId, path);
    // In compound controls (Yes/No, month-year) the label is bound to the first sub-control;
    // hint and error ids are derived from the same id.
    const labelFor = field.type === "yesno" ? `${id}-${YES}` : field.type === "month" ? `${id}-month` : id;
    const aria = { "aria-invalid": error ? true : undefined, "aria-describedby": describedBy(labelFor, field.hint, error) } as const;
    const common = { id, name: path, required: field.required, ...aria };
    const wide = field.width !== "half";

    let control: ReactNode;
    switch (field.type) {
      case "textarea":
        control = (
          <Textarea
            {...common}
            rows={field.rows ?? 3}
            maxLength={field.maxLength}
            placeholder={field.placeholder}
            value={value}
            onChange={(e) => setValue(path, e.target.value)}
          />
        );
        break;
      case "select":
        control = (
          <Select {...common} value={value} onChange={(e) => setValue(path, e.target.value)}>
            <option value="">Seçiniz</option>
            {field.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        );
        break;
      case "yesno":
        control = (
          <YesNoInput id={id} name={path} label={field.label} value={value} onChange={(v) => setValue(path, v)} invalid={Boolean(error)} describedById={aria["aria-describedby"]} />
        );
        break;
      case "date": {
        // Date rules (past/future, other dates, "last 10 years") decide which days can be picked in the calendar.
        const limits = dateLimits(field, local, rootWith(data), today);
        control = (
          <DateInput
            id={id}
            name={path}
            required={field.required}
            value={value}
            min={limits.min}
            max={limits.max}
            onChange={(v) => setValue(path, v)}
            {...aria}
          />
        );
        break;
      }
      case "month": {
        const limits = dateLimits(field, local, rootWith(data), today);
        control = (
          <MonthInput
            id={id}
            value={value}
            onChange={(v) => setValue(path, v)}
            invalid={Boolean(error)}
            describedById={aria["aria-describedby"]}
            today={today}
            min={limits.min}
            max={limits.max}
          />
        );
        break;
      }
      case "money":
        control = <Input {...common} type="text" inputMode="decimal" autoComplete="off" placeholder="Örn. 45.000" value={value} onChange={(e) => setValue(path, e.target.value)} />;
        break;
      case "phone":
        control = (
          <PhoneInput
            id={id}
            name={path}
            label={field.label}
            value={value}
            required={field.required}
            onChange={(v) => setValue(path, v)}
            invalid={Boolean(error)}
            describedById={aria["aria-describedby"]}
          />
        );
        break;
      case "email":
        control = <Input {...common} type="email" inputMode="email" autoComplete="email" value={value} onChange={(e) => setValue(path, e.target.value)} />;
        break;
      case "nationalId":
        control = (
          <Input {...common} type="text" inputMode="numeric" autoComplete="off" maxLength={11} value={value} onChange={(e) => setValue(path, e.target.value.replace(/[^0-9]/g, ""))} />
        );
        break;
      default:
        control = (
          <Input
            {...common}
            type="text"
            autoComplete={field.autoComplete ?? "off"}
            maxLength={field.maxLength}
            autoCapitalize={field.uppercase ? "characters" : undefined}
            placeholder={field.placeholder}
            value={value}
            onChange={(e) => setValue(path, e.target.value)}
          />
        );
    }

    return (
      <FieldShell
        key={path}
        id={labelFor}
        label={field.label}
        hint={field.hint}
        error={error}
        required={field.required}
        className={wide ? "sm:col-span-2" : undefined}
        labelExtra={help ? <FieldHelpButton help={help} imageAvailable={Boolean(help.image && availableHelpImages.includes(help.image))} fieldLabel={field.label} /> : null}
      >
        {control}
      </FieldShell>
    );
  };

  const renderRepeat = (field: RepeatField, path: string, local: Obj): ReactNode => {
    const items = Array.isArray(local[field.key]) ? (local[field.key] as unknown[]) : [];
    // The number of entries can depend on an answer (e.g. a single trip if you went "Bir defa").
    const limits = repeatLimits(field, local, rootWith(data));
    const listError = showErrors ? errors[path] : undefined;
    return (
      <fieldset key={path} className="sm:col-span-2">
        <legend className="text-sm font-bold text-dash-navy">{field.label}</legend>
        {field.hint ? <p className="mt-1 text-[13px] leading-normal text-dash-ink-3">{field.hint}</p> : null}
        <div className="mt-3 space-y-3">
          {items.map((item, index) => {
            const itemPath = `${path}.${index}`;
            return (
              <div key={itemPath} className="rounded-[20px] bg-dash-canvas p-4 sm:p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <p className="text-sm font-bold text-dash-navy">
                    {field.itemLabel} {index + 1}
                  </p>
                  {items.length > limits.min ? (
                    <WizButton
                      variant="secondary"
                      size="sm"
                      onClick={() => setValue(path, items.filter((_, i) => i !== index))}
                      aria-label={`${field.itemLabel} ${index + 1} kaydını sil`}
                    >
                      <Trash2 aria-hidden className="size-4" strokeWidth={2.5} />
                      Sil
                    </WizButton>
                  ) : null}
                </div>
                <div className="grid gap-x-6 gap-y-[22px] sm:grid-cols-2">{renderFields(field.fields, itemPath, isObj(item) ? item : {})}</div>
              </div>
            );
          })}
        </div>
        {listError ? <p className="mt-2 text-[13px] font-semibold text-dash-red">{listError}</p> : null}
        {trimmedLists.includes(path) && items.length >= limits.max ? (
          <p role="status" className="mt-2 text-[13px] font-semibold text-dash-ink-2">
            {limits.max === 1
              ? "Seçtiğiniz cevaba göre yalnızca bir kayıt girilir; fazla kayıtlar kaldırıldı."
              : `Seçtiğiniz cevaba göre en fazla ${limits.max} kayıt girilir; fazla kayıtlar kaldırıldı.`}
          </p>
        ) : null}
        {items.length < limits.max ? (
          <WizButton id={`${idFor(path)}-add`} variant="secondary" size="md" className="mt-3" onClick={() => setValue(path, [...items, emptyRepeatItem(field)])}>
            <Plus aria-hidden className="size-4" strokeWidth={2.75} />
            {field.addLabel}
          </WizButton>
        ) : limits.max === 1 ? null : (
          <p className="mt-3 text-[13px] text-dash-ink-3">En fazla {limits.max} kayıt ekleyebilirsiniz.</p>
        )}
      </fieldset>
    );
  };

  const renderFields = (fields: readonly Field[], prefix: string, local: Obj): ReactNode[] => {
    const root = rootWith(data);
    const nodes: ReactNode[] = [];
    for (const field of fields) {
      if (!isFieldVisible(field, local, root)) continue;
      const path = prefix ? `${prefix}.${field.key}` : field.key;
      if (field.type === "group") {
        const value = isObj(local[field.key]) ? (local[field.key] as Obj) : {};
        nodes.push(
          <fieldset key={path} className="rounded-[20px] border-[1.5px] border-dash-field p-4 sm:col-span-2 sm:p-5">
            {/* float: the legend sits inside the box instead of on top of the border. */}
            <legend className="float-left w-full text-sm font-bold text-dash-navy">{field.label}</legend>
            {field.hint ? <p className="clear-both pt-1 text-[13px] leading-normal text-dash-ink-3">{field.hint}</p> : null}
            <div className="clear-both grid gap-x-6 gap-y-[22px] pt-4 sm:grid-cols-2">{renderFields(field.fields, path, value)}</div>
          </fieldset>,
        );
      } else if (field.type === "repeat") {
        nodes.push(renderRepeat(field, path, local));
      } else {
        nodes.push(renderScalar(field, path, local));
      }
    }
    return nodes;
  };

  return (
    <form
      noValidate
      className="flex flex-1 flex-col"
      // A client function is passed as `action`: if the form is submitted before the page is interactive (before JavaScript
      // loads) React holds the submission; the browser NEVER writes field values into the address bar (URL).
      action={() => {
        void saveAndContinue();
      }}
    >
      <WizardBody className="pt-7">
        {online ? null : (
          <WizNote tone="warning" role="status" title="İnternet bağlantınız kesildi">
            Yazdıklarınız bu sayfada duruyor ancak şu anda kaydedilemiyor. Sayfayı kapatmayınız; bağlantınız gelince değişiklikleriniz
            kendiliğinden kaydedilecek.
          </WizNote>
        )}
        {showErrors && errorCount > 0 ? (
          <div ref={errorSummaryRef} tabIndex={-1}>
            <WizNote tone="danger" role="alert" title={`${errorCount} alanda eksik veya hatalı bilgi var`}>
              Devam etmek için aşağıda işaretlenen alanları düzeltiniz. Dilerseniz başka bir bölüme geçip buraya daha sonra
              dönebilirsiniz; kaydedilen cevaplarınız korunur.
            </WizNote>
          </div>
        ) : null}

        {prefillState === "offered" ? (
          <WizNote tone="info" title="Testte verdiğiniz cevapları kullanmak ister misiniz?">
            <p>
              Risk Analiz Testi&apos;nde verdiğiniz cevaplara göre başvuru formunuzdaki şu alanları sizin yerinize tek seferde
              doldurabiliriz. Doldurulan alanları dilediğiniz zaman değiştirebilirsiniz.
            </p>
            <dl className="mt-3 space-y-2">
              {prefill.map((group) => (
                <div key={group.sectionId}>
                  <dt className="font-bold">{group.title}</dt>
                  <dd>
                    <ul className="list-disc space-y-1 pl-5">
                      {group.items.map((item) => (
                        <li key={item.path}>
                          {item.label}: <strong className="font-bold">{item.display}</strong>
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ))}
            </dl>
            {prefillError ? (
              <p role="alert" className="mt-3 font-semibold text-dash-red">
                {prefillError}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2.5">
              <WizButton size="md" onClick={() => void acceptPrefill()} disabled={prefillBusy}>
                {prefillBusy ? "Dolduruluyor…" : "Evet, hepsini doldur"}
              </WizButton>
              <WizButton size="md" variant="secondary" onClick={declinePrefill} disabled={prefillBusy}>
                Hayır, kendim dolduracağım
              </WizButton>
            </div>
          </WizNote>
        ) : null}
        {prefillState === "applied" ? (
          <WizNote tone="success" role="status">
            Testteki cevaplarınız formunuzdaki {prefillFilled} alana yazıldı ve kaydedildi. İlgili bölümlerde kontrol edebilir, gerekirse
            değiştirebilirsiniz.
          </WizNote>
        ) : null}

        <div className="grid gap-x-6 gap-y-[26px] sm:grid-cols-2">{renderFields(section.fields, "", data)}</div>
      </WizardBody>

      <WizardFooter
        start={
          <div className="flex min-h-6 flex-col gap-1 text-[13px] text-dash-ink-3">
            {saveState.kind === "error" ? (
              <span role="alert" className="font-semibold text-dash-red">
                Kaydedilemedi: {saveState.message}{" "}
                <button type="button" className="underline underline-offset-[3px]" onClick={() => void persist()}>
                  Tekrar dene
                </button>
              </span>
            ) : null}
            {visibleNotice ? (
              <span role="alert" className="font-semibold text-dash-red">
                {visibleNotice}
              </span>
            ) : null}
            {required.total > 0 ? (
              <span>
                {required.filled} / {required.total} zorunlu alan dolduruldu
              </span>
            ) : null}
          </div>
        }
        end={
          <>
            {prevHref ? (
              <Link href={prevHref} className={wizButtonClass("secondary")}>
                Geri
              </Link>
            ) : null}
            <WizButton variant="secondary" onClick={() => void saveNow()} disabled={saveState.kind === "saving"}>
              Kaydet
            </WizButton>
            <WizButton type="submit" disabled={navigating}>
              {navigating ? "Kaydediliyor…" : nextLabel}
              {navigating ? null : <ArrowRight aria-hidden className="size-4" strokeWidth={2.75} />}
            </WizButton>
          </>
        }
      />
    </form>
  );
}
