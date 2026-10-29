"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/components/ui/primitives";
import { monthsCovering, WEEKDAY_LONG_LABELS, WEEKDAY_SHORT_LABELS } from "@/features/appointments/calendar";
import type { AppointmentPreference } from "@/features/appointments/window";
import { APPOINTMENT_SLOT_LABELS, CALENDAR_APPOINTMENT_SLOTS, type AppointmentSlot } from "@/lib/domain/constants";
import { formatDateLongTr } from "@/lib/validation/formats";

const monthNavButton =
  "inline-flex size-9 items-center justify-center rounded-full border-[1.5px] border-dash-field bg-white text-dash-navy transition-colors motion-reduce:transition-none hover:bg-dash-subtle disabled:cursor-default disabled:opacity-35 disabled:hover:bg-white";

/**
 * Appointment preference calendar.
 * Calendar on the left: the customer picks the days they are free (at most `max`); only offered days can be picked, the
 * others are faded. The calendar shows one month; month buttons only appear if another month also has selectable days.
 * Selected days on the right (below on narrow screens): for each day, all day, morning or afternoon is asked.
 * Look: round days, red order badge, pill-shaped time choice.
 */
export function AvailabilityCalendar({
  dates,
  selected,
  max,
  onToggleDay,
  onSlot,
}: {
  /** Selectable days. */
  dates: readonly string[];
  /** In order of selection. */
  selected: readonly AppointmentPreference[];
  max: number;
  onToggleDay: (date: string) => void;
  onSlot: (date: string, slot: AppointmentSlot) => void;
}) {
  const available = new Set(dates);
  const months = monthsCovering(dates);
  const rankOf = (date: string) => selected.findIndex((p) => p.date === date) + 1;
  const [index, setIndex] = useState(0);
  const current = Math.min(index, Math.max(0, months.length - 1));
  const month = months[current];
  const hasOtherMonths = months.length > 1;
  const laterCount = months.slice(current + 1).reduce((sum, m) => sum + dates.filter((d) => d.startsWith(m.key)).length, 0);

  return (
    <div className="grid items-start gap-7 md:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <div className="flex flex-col gap-3.5">
        {month ? (
          <div className="flex flex-col gap-2 rounded-[24px] border-[1.5px] border-dash-field px-3 pb-5 pt-5 sm:px-5 sm:pt-6">
            <div className="flex items-center justify-between gap-2 pb-2">
              {hasOtherMonths ? (
                <button type="button" onClick={() => setIndex(current - 1)} disabled={current === 0} aria-label="Önceki ay" className={monthNavButton}>
                  <ChevronLeft aria-hidden className="size-4" strokeWidth={2.75} />
                </button>
              ) : (
                <span aria-hidden className="size-9" />
              )}
              <h4 className="text-base font-extrabold" aria-live="polite">
                {month.label}
              </h4>
              {hasOtherMonths ? (
                <button
                  type="button"
                  onClick={() => setIndex(current + 1)}
                  disabled={current >= months.length - 1}
                  aria-label="Sonraki ay"
                  className={monthNavButton}
                >
                  <ChevronRight aria-hidden className="size-4" strokeWidth={2.75} />
                </button>
              ) : (
                <span aria-hidden className="size-9" />
              )}
            </div>
            <table className="w-full table-fixed border-separate border-spacing-x-0 border-spacing-y-1.5 text-center text-sm">
              <caption className="sr-only">{month.label} — seçilebilir günler</caption>
              <thead>
                <tr>
                  {WEEKDAY_SHORT_LABELS.map((label, i) => (
                    <th key={label} scope="col" abbr={WEEKDAY_LONG_LABELS[i]} className="pb-1.5 text-xs font-bold text-dash-ink-3">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {month.weeks.map((week, w) => (
                  <tr key={w}>
                    {week.map((date, d) => {
                      if (!date) return <td key={d} />;
                      const day = Number(date.slice(8, 10));
                      if (!available.has(date)) {
                        return (
                          <td key={d}>
                            <span className="mx-auto flex size-9 items-center justify-center font-medium text-dash-check sm:size-10" aria-hidden>
                              {day}
                            </span>
                          </td>
                        );
                      }
                      const rank = rankOf(date);
                      const slot = rank > 0 ? selected[rank - 1]!.slot : null;
                      return (
                        <td key={d}>
                          <button
                            type="button"
                            aria-pressed={rank > 0}
                            aria-label={`${formatDateLongTr(date)}${slot ? ` — seçildi, ${APPOINTMENT_SLOT_LABELS[slot]}` : ""}`}
                            onClick={() => onToggleDay(date)}
                            className={cn(
                              "relative mx-auto flex size-9 items-center justify-center rounded-full text-sm font-bold transition-colors motion-reduce:transition-none sm:size-10",
                              rank > 0 ? "bg-dash-navy text-white" : "bg-dash-line-soft text-dash-navy hover:bg-dash-line-strong",
                            )}
                          >
                            {day}
                            {rank > 0 ? (
                              <span
                                aria-hidden
                                className="absolute -right-1 -top-1 flex size-[19px] items-center justify-center rounded-full border-2 border-white bg-dash-red text-[11px] font-extrabold text-white"
                              >
                                {rank}
                              </span>
                            ) : null}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {laterCount > 0 ? (
          <p className="px-1.5 text-xs leading-normal text-dash-ink-3">Sonraki aylarda da seçilebilir günler var; takvimin üstündeki ok ile geçebilirsiniz.</p>
        ) : null}
        <p className="flex flex-wrap items-center gap-x-[18px] gap-y-1 px-1.5 text-xs text-dash-ink-3">
          <span className="flex items-center gap-[7px]">
            <span aria-hidden className="size-3 rounded-full bg-dash-line-soft" /> Seçilebilir gün
          </span>
          <span className="flex items-center gap-[7px]">
            <span aria-hidden className="size-3 rounded-full bg-dash-navy" /> Seçtiğiniz gün
          </span>
        </p>
      </div>

      <div className="flex min-w-0 flex-col gap-2.5">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-base font-bold">
            Seçtiğiniz günler ({selected.length}/{max})
          </h3>
          {/* The priority order of the preferences is stated explicitly. */}
          <p className="text-[13px] leading-normal text-dash-ink-3">
            Günler öncelik sıranıza göre listelenir: ilk seçtiğiniz gün 1. tercihinizdir. Sırayı değiştirmek için günü kaldırıp yeniden seçiniz.
            {selected.length > 0 ? " Her gün için müsait olduğunuz vakti de seçiniz." : ""}
          </p>
        </div>
        {selected.length === 0 ? (
          <p className="rounded-[20px] border-2 border-dashed border-dash-field px-5 py-7 text-center text-sm text-dash-ink-3">
            Takvimden müsait olduğunuz bir gün seçiniz.
          </p>
        ) : (
          <ol className="flex flex-col gap-2.5">
            {selected.map((preference, order) => (
              <li key={preference.date} className="rounded-[18px] border-[1.5px] border-dash-field pb-3 pl-4 pr-3 pt-2.5">
                <fieldset className="relative">
                  {/* The legend must be the first child of the fieldset; with float it sits in the normal flow. */}
                  <legend className="float-left mb-2 flex w-full items-center gap-2.5 py-0.5 pr-10 text-sm font-bold">
                    <span aria-hidden className="flex size-6 flex-none items-center justify-center rounded-full bg-dash-navy text-xs font-extrabold text-white">
                      {order + 1}
                    </span>
                    <span>
                      <span className="sr-only">{order + 1}. </span>
                      {formatDateLongTr(preference.date)}
                    </span>
                  </legend>
                  <button
                    type="button"
                    onClick={() => onToggleDay(preference.date)}
                    className="absolute right-0 top-0 inline-flex size-7 items-center justify-center rounded-full text-dash-ink-2 hover:bg-dash-subtle hover:text-dash-navy"
                    aria-label={`${formatDateLongTr(preference.date)} seçimini kaldır`}
                  >
                    <X aria-hidden className="size-4" strokeWidth={2.5} />
                  </button>
                  <div className="clear-both flex gap-1 rounded-full bg-dash-subtle p-[3px]">
                    {CALENDAR_APPOINTMENT_SLOTS.map((slot) => {
                      const id = `slot-${preference.date}-${slot}`;
                      return (
                        <span key={slot} className="flex min-w-0 flex-1">
                          <input
                            id={id}
                            type="radio"
                            name={`slot-${preference.date}`}
                            className="peer sr-only"
                            checked={preference.slot === slot}
                            onChange={() => onSlot(preference.date, slot)}
                          />
                          <label
                            htmlFor={id}
                            className="flex min-h-8 w-full items-center justify-center rounded-full px-2.5 py-1 text-center text-[13px] font-bold leading-tight text-dash-ink-2 transition-colors motion-reduce:transition-none hover:text-dash-navy peer-checked:bg-dash-navy peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-dash-red"
                          >
                            {APPOINTMENT_SLOT_LABELS[slot]}
                          </label>
                        </span>
                      );
                    })}
                  </div>
                </fieldset>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
