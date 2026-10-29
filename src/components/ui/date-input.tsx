"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover } from "radix-ui";
import { monthGrid, WEEKDAY_LONG_LABELS, WEEKDAY_SHORT_LABELS } from "@/features/appointments/calendar";
import { figtree } from "@/lib/fonts/figtree";
import { addDaysIso, formatDateLongTr, formatDateTr, isValidIsoDate, maskDateTyping, parseDateInput, todayInIstanbul } from "@/lib/validation/formats";
import { Input } from "./form";
import { cn } from "./primitives";

/*
 * DATE FIELD
 * A date can be entered in two ways: by typing into the field ("GG.AA.YYYY", dots are added automatically) or by picking
 * from the calendar opened with the calendar button on the right. Month and year are chosen from lists in the calendar;
 * days outside the allowed range (e.g. the return date cannot be before the departure date) are faded and cannot be picked.
 * Keyboard: arrows move by day, Page Up/Down by month, Home/End to the start/end of the week, Enter selects, Esc closes.
 *
 * The value is reported as "YYYY-MM-DD"; for incomplete or invalid input the typed text is reported as is (validation says
 * "Geçerli bir tarih giriniz"). If `name` is given the field submits "GG.AA.YYYY" with the form; the server accepts both formats.
 */

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const FIRST_YEAR = 1900;

const toDisplay = (value: string) => (isValidIsoDate(value) ? formatDateTr(value) : value);

const monthKey = (iso: string) => iso.slice(0, 7);
const clampIso = (iso: string, min: string | null, max: string | null) => (min && iso < min ? min : max && iso > max ? max : iso);

function addMonths(key: string, months: number): string {
  const [y, m] = key.split("-").map(Number) as [number, number];
  const index = y * 12 + (m - 1) + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** The given day of the month; the last day if the month has no such day (31 → 30 in April). */
function dayInMonth(key: string, day: number): string {
  for (let d = day; d > 28; d--) {
    const candidate = `${key}-${String(d).padStart(2, "0")}`;
    if (isValidIsoDate(candidate)) return candidate;
  }
  return `${key}-${String(Math.min(day, 28)).padStart(2, "0")}`;
}

/** Keeps the same day number in another month (31 March → 30 April). */
function moveMonths(iso: string, months: number): string {
  return dayInMonth(addMonths(monthKey(iso), months), Number(iso.slice(8, 10)));
}

type DateInputProps = {
  id: string;
  /** Field name when submitted with a form (value "GG.AA.YYYY"). */
  name?: string;
  /** Controlled use: "YYYY-MM-DD" or the text being typed. */
  value?: string;
  /** Uncontrolled use (forms): initial value. */
  defaultValue?: string;
  onChange?: (value: string) => void;
  /**
   * Earliest / latest selectable day ("YYYY-MM-DD"). "today" means today; today is only computed when the calendar opens
   * (the clock is not read while the page is prerendered).
   */
  min?: string | null;
  max?: string | null;
  required?: boolean;
  disabled?: boolean;
  autoComplete?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

export function DateInput({ id, name, value, defaultValue = "", onChange, min = null, max = null, required, disabled, autoComplete, ...aria }: DateInputProps) {
  const controlled = value !== undefined;
  const [text, setText] = useState(() => toDisplay(controlled ? value : defaultValue));
  const [open, setOpen] = useState(false);
  const lastEmitted = useRef(controlled ? value : defaultValue);
  const contentRef = useRef<HTMLDivElement>(null);

  // If the value changes from outside (e.g. after saving) the text in the field is updated; a value we reported ourselves does not disturb the text.
  useEffect(() => {
    if (!controlled || value === lastEmitted.current) return;
    lastEmitted.current = value;
    setText(toDisplay(value));
  }, [controlled, value]);

  const emit = (next: string) => {
    lastEmitted.current = next;
    onChange?.(next);
  };

  const typed = (raw: string) => {
    const masked = maskDateTyping(raw);
    setText(masked);
    emit(parseDateInput(masked) ?? masked);
  };

  const pick = (iso: string) => {
    setText(formatDateTr(iso));
    emit(iso);
    setOpen(false);
  };

  const current = parseDateInput(text);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div className="relative">
          <Input
            id={id}
            name={name}
            type="text"
            inputMode="numeric"
            autoComplete={autoComplete ?? "off"}
            placeholder="GG.AA.YYYY"
            maxLength={10}
            required={required}
            disabled={disabled}
            value={text}
            onChange={(e) => typed(e.target.value)}
            onBlur={() => {
              if (current) setText(formatDateTr(current));
            }}
            className="pr-12"
            {...aria}
          />
          <Popover.Trigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label={current ? `Takvimi aç, seçili tarih ${formatDateLongTr(current)}` : "Takvimi aç"}
              className="absolute right-1.5 top-1/2 inline-flex size-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-dash-ink-3 transition-colors hover:bg-dash-subtle hover:text-dash-navy focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-dash-navy disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent motion-reduce:transition-none"
            >
              <CalendarDays aria-hidden className="size-[18px]" strokeWidth={2.25} />
            </button>
          </Popover.Trigger>
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          ref={contentRef}
          onOpenAutoFocus={(event) => {
            // When the calendar opens, focus moves to the selected day (or today).
            event.preventDefault();
            contentRef.current?.querySelector<HTMLButtonElement>('button[data-date][tabindex="0"]')?.focus();
          }}
          align="end"
          sideOffset={8}
          collisionPadding={12}
          aria-label="Tarih seçin"
          className={cn(
            figtree.variable,
            "dash-root z-[60] w-[min(20.5rem,calc(100vw-1.5rem))] rounded-[22px] border border-dash-line bg-white p-4 font-dash text-dash-ink shadow-[0_18px_48px_color-mix(in_srgb,var(--color-dash-navy)_18%,transparent)]",
          )}
        >
          <Calendar selected={current} min={min} max={max} onPick={pick} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Calendar({ selected, min: minProp, max: maxProp, onPick }: { selected: string | null; min: string | null; max: string | null; onPick: (iso: string) => void }) {
  const today = todayInIstanbul();
  const min = minProp === "today" ? today : minProp;
  const max = maxProp === "today" ? today : maxProp;
  const initial = clampIso(selected ?? today, min, max);
  const [focused, setFocused] = useState(initial);
  const [shown, setShown] = useState(monthKey(initial));
  const grid = monthGrid(shown);
  const gridRef = useRef<HTMLTableElement>(null);
  const labelId = useId();
  const moveFocus = useRef(false);

  const minYear = min ? Number(min.slice(0, 4)) : FIRST_YEAR;
  const maxYear = max ? Number(max.slice(0, 4)) : Number(today.slice(0, 4)) + 20;
  const years = Array.from({ length: Math.max(1, maxYear - minYear + 1) }, (_, i) => maxYear - i);
  const allowed = (iso: string) => (!min || iso >= min) && (!max || iso <= max);
  const monthAllowed = (key: string) => (!min || key >= monthKey(min)) && (!max || key <= monthKey(max));

  // When the day changes via the keyboard, focus moves to the new day (it stays put when changing months with the mouse).
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focused}"]`)?.focus();
  }, [focused, shown]);

  const show = (key: string) => {
    if (!monthAllowed(key)) return;
    setShown(key);
    setFocused(clampIso(dayInMonth(key, Number(focused.slice(8, 10))), min, max));
  };

  const focusDate = (iso: string) => {
    const next = clampIso(iso, min, max);
    moveFocus.current = true;
    setFocused(next);
    setShown(monthKey(next));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const weekday = (new Date(`${focused}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDaysIso(focused, -1),
      ArrowRight: () => addDaysIso(focused, 1),
      ArrowUp: () => addDaysIso(focused, -7),
      ArrowDown: () => addDaysIso(focused, 7),
      PageUp: () => moveMonths(focused, event.shiftKey ? -12 : -1),
      PageDown: () => moveMonths(focused, event.shiftKey ? 12 : 1),
      Home: () => addDaysIso(focused, -weekday),
      End: () => addDaysIso(focused, 6 - weekday),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    focusDate(move());
  };

  const navButton =
    "inline-flex size-9 flex-none cursor-pointer items-center justify-center rounded-full text-dash-navy transition-colors hover:bg-dash-subtle disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent motion-reduce:transition-none";
  const selectClass =
    "h-9 cursor-pointer appearance-none rounded-full border-[1.5px] border-dash-field bg-white px-3 text-sm font-bold text-dash-navy hover:border-dash-check focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-dash-navy";
  const [shownYear, shownMonth] = shown.split("-").map(Number) as [number, number];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-1.5">
        <button type="button" className={navButton} aria-label="Önceki ay" disabled={!monthAllowed(addMonths(shown, -1))} onClick={() => show(addMonths(shown, -1))}>
          <ChevronLeft aria-hidden className="size-4" strokeWidth={2.75} />
        </button>
        <div className="flex items-center gap-1.5" id={labelId}>
          <label className="sr-only" htmlFor={`${labelId}-month`}>
            Ay
          </label>
          <select
            id={`${labelId}-month`}
            className={selectClass}
            value={shownMonth}
            onChange={(e) => show(`${shownYear}-${String(Number(e.target.value)).padStart(2, "0")}`)}
          >
            {MONTHS.map((name, i) => {
              const key = `${shownYear}-${String(i + 1).padStart(2, "0")}`;
              return (
                <option key={name} value={i + 1} disabled={!monthAllowed(key)}>
                  {name}
                </option>
              );
            })}
          </select>
          <label className="sr-only" htmlFor={`${labelId}-year`}>
            Yıl
          </label>
          <select
            id={`${labelId}-year`}
            className={selectClass}
            value={shownYear}
            onChange={(e) => {
              const key = clampIso(`${e.target.value}-${String(shownMonth).padStart(2, "0")}-01`, min ? `${monthKey(min)}-01` : null, max ? `${monthKey(max)}-01` : null);
              show(monthKey(key));
            }}
          >
            {years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className={navButton} aria-label="Sonraki ay" disabled={!monthAllowed(addMonths(shown, 1))} onClick={() => show(addMonths(shown, 1))}>
          <ChevronRight aria-hidden className="size-4" strokeWidth={2.75} />
        </button>
      </div>

      <table ref={gridRef} role="grid" aria-label={grid.label} className="w-full table-fixed border-collapse text-center" onKeyDown={onKeyDown}>
        <thead>
          <tr>
            {WEEKDAY_SHORT_LABELS.map((label, i) => (
              <th key={label} scope="col" abbr={WEEKDAY_LONG_LABELS[i]} className="pb-1.5 text-[11px] font-bold uppercase tracking-[0.04em] text-dash-ink-3">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.weeks.map((week, w) => (
            <tr key={w}>
              {week.map((date, d) => {
                if (!date) return <td key={d} className="p-0.5" />;
                const enabled = allowed(date);
                const isSelected = date === selected;
                const isToday = date === today;
                return (
                  <td key={d} className="p-0.5">
                    <button
                      type="button"
                      data-date={date}
                      tabIndex={date === focused ? 0 : -1}
                      disabled={!enabled}
                      aria-pressed={isSelected}
                      aria-current={isToday ? "date" : undefined}
                      aria-label={`${formatDateLongTr(date)}${isToday ? ", bugün" : ""}${enabled ? "" : ", seçilemez"}`}
                      onClick={() => onPick(date)}
                      onFocus={() => setFocused(date)}
                      className={cn(
                        "relative mx-auto flex size-9 cursor-pointer items-center justify-center rounded-full text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-dash-navy motion-reduce:transition-none",
                        isSelected
                          ? "bg-dash-navy font-bold text-white hover:bg-dash-navy-hover"
                          : enabled
                            ? "text-dash-navy hover:bg-dash-line-soft"
                            : "cursor-default text-dash-check",
                        isToday && !isSelected ? "ring-[1.5px] ring-inset ring-dash-field font-bold" : null,
                      )}
                    >
                      {Number(date.slice(8, 10))}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {allowed(today) ? (
        <div className="flex justify-end border-t border-dash-line-soft pt-2.5">
          <button
            type="button"
            className="cursor-pointer rounded-full px-3 py-1.5 text-[13px] font-bold text-dash-navy transition-colors hover:bg-dash-subtle motion-reduce:transition-none"
            onClick={() => onPick(today)}
          >
            Bugün
          </button>
        </div>
      ) : null}
    </div>
  );
}
