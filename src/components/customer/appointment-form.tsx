"use client";

import { useRouter } from "next/navigation";
import { useLayoutEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Select } from "@/components/ui/form";
import { callAction, isOffline, OFFLINE_MESSAGE } from "@/components/ui/network";
import { cn } from "@/components/ui/primitives";
import { MAX_ALTERNATIVE_PREFERENCES, MAX_PREFERENCE_COUNT, mergeSameDayPreferences, type AppointmentPreference } from "@/features/appointments/window";
import type { AppointmentSlot } from "@/lib/domain/constants";
import { saveAppointmentPreferencesAction } from "@/server/actions/applications";
import { AvailabilityCalendar } from "./availability-calendar";
import { WizardBody, WizardFooter, WizButton, WizCheckbox, WizField, WizLinkButton, WizNote } from "./wizard/ui";

type DateOption = { date: string; label: string };
/** `label`: name shown in the list; with a surcharge, e.g. "Ankara (+1.250 TL ek ücret)". */
type CityOption = { id: string; label: string; hasSurcharge: boolean };

/** Picking a day in the calendar: the day is added as "Tüm gün" (all day) and removed when clicked again; at most `max` days. */
function useDaySelection(initial: AppointmentPreference[], max: number, onLimit: () => void, onChange: () => void) {
  const [days, setDays] = useState<AppointmentPreference[]>(initial);
  const toggle = (date: string) => {
    onChange();
    if (days.some((p) => p.date === date)) {
      setDays(days.filter((p) => p.date !== date));
      return;
    }
    if (days.length >= max) {
      onLimit();
      return;
    }
    setDays([...days, { date, slot: "full_day" }]);
  };
  const setSlot = (date: string, slot: AppointmentSlot) => setDays(days.map((p) => (p.date === date ? { date, slot } : p)));
  return { days, toggle, setSlot };
}

/**
 * Appointment city and appointment preferences. Preferences are picked from a calendar: the customer
 * picks three of the offered days and says all day, morning or afternoon for each; the order of selection is the order of
 * preference. If none of the offered dates suit, the calendar opens further ahead (about three months) and at most three
 * days are enough. This screen does NOT book an appointment; it only stores the preferences the consultant considers when looking for one.
 */
export function AppointmentForm({
  applicationId,
  dates,
  alternativeDates,
  initial,
  initialOutsideWindow,
  cities,
  initialCityId,
  nextHref,
  backHref = null,
  saveLabel,
  intro,
}: {
  applicationId: string;
  dates: DateOption[];
  /** Working days offered once "Bu tarihlerin hiçbiri bana uymuyor" (none of these dates suit me) is ticked. */
  alternativeDates: DateOption[];
  initial: AppointmentPreference[];
  initialOutsideWindow: boolean;
  /** Selectable appointment cities. If empty the city is not asked (the company has not defined cities or the application was submitted). */
  cities: CityOption[];
  initialCityId: string | null;
  /** If given, navigate to this address after saving (wizard). */
  nextHref: string | null;
  /** Previous step in the wizard ("Geri"). */
  backHref?: string | null;
  saveLabel: string;
  /** Notes to show inside the card before the form. */
  intro?: ReactNode;
}) {
  const router = useRouter();
  const allowed = new Set(dates.map((d) => d.date));
  const allowedAlternative = new Set(alternativeDates.map((d) => d.date));
  // The calendar shows each day once; two time slots of the same day in an old record count as "Tüm gün". Preferences
  // that now fall outside the range are dropped at the start.
  const merged = mergeSameDayPreferences(initial);
  const initialPool = initialOutsideWindow ? allowedAlternative : allowed;
  const kept = merged.filter((p) => initialPool.has(p.date));
  const dropped = merged.length - kept.length;

  const [outside, setOutside] = useState(initialOutsideWindow);
  const [message, setMessage] = useState<{ tone: "danger" | "success"; text: string } | null>(null);

  // When "Bu tarihlerin hiçbiri bana uymuyor" is ticked the calendar above disappears and the one below opens; the page is
  // scrolled just enough for the checkbox to stay in the same place on screen.
  const outsideBoxRef = useRef<HTMLDivElement>(null);
  const outsideBoxTop = useRef<number | null>(null);
  useLayoutEffect(() => {
    const before = outsideBoxTop.current;
    outsideBoxTop.current = null;
    if (before === null || !outsideBoxRef.current) return;
    const shift = outsideBoxRef.current.getBoundingClientRect().top - before;
    if (Math.abs(shift) >= 1) window.scrollBy({ top: shift, behavior: "instant" });
  }, [outside]);
  const limitMessage = (max: number) => () =>
    setMessage({ tone: "danger", text: `En fazla ${max === 3 ? "üç" : max} gün seçebilirsiniz. Başka bir gün için önce seçimlerinizden birini kaldırınız.` });
  const clearMessage = () => setMessage(null);
  const normal = useDaySelection(initialOutsideWindow ? [] : kept, MAX_PREFERENCE_COUNT, limitMessage(MAX_PREFERENCE_COUNT), clearMessage);
  const later = useDaySelection(initialOutsideWindow ? kept : [], MAX_ALTERNATIVE_PREFERENCES, limitMessage(MAX_ALTERNATIVE_PREFERENCES), clearMessage);

  // If a city that is no longer active is selected, the selection starts empty.
  const [cityId, setCityId] = useState(() => (cities.some((c) => c.id === initialCityId) ? (initialCityId ?? "") : ""));
  const [cityError, setCityError] = useState<string | null>(null);
  const asksCity = cities.length > 0;
  const [pending, startTransition] = useTransition();

  const save = () => {
    if (asksCity && cityId === "") {
      setCityError("Randevu şehrini seçiniz.");
      setMessage({ tone: "danger", text: "Lütfen randevu şehrini seçiniz." });
      return;
    }
    if (outside && later.days.length === 0) {
      setMessage({ tone: "danger", text: "Takvimden size uygun en az bir gün seçiniz (en fazla üç)." });
      return;
    }
    if (!outside && normal.days.length === 0) {
      setMessage({ tone: "danger", text: "Takvimden size uygun en az bir gün seçiniz (en fazla üç)." });
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const result = await callAction(() => saveAppointmentPreferencesAction(applicationId, outside ? later.days : normal.days, asksCity ? cityId : null, outside));
      if (!result.ok) {
        setCityError("fieldErrors" in result ? (result.fieldErrors?.cityId ?? null) : null);
        setMessage({ tone: "danger", text: result.message });
        return;
      }
      // While offline the next page cannot load; stay on this page instead of landing on the browser's error page.
      if (nextHref && isOffline()) setMessage({ tone: "danger", text: `Tercihleriniz kaydedildi ancak sonraki adıma geçilemedi. ${OFFLINE_MESSAGE}` });
      else if (nextHref) router.push(nextHref);
      else {
        setMessage({ tone: "success", text: result.message ?? "Kaydedildi." });
        router.refresh();
      }
    });
  };

  const back = backHref ? (
    <WizLinkButton href={backHref} variant="secondary">
      Geri
    </WizLinkButton>
  ) : null;

  if (dates.length === 0 && alternativeDates.length === 0) {
    return (
      <>
        <WizardBody>
          {intro}
          <WizNote tone="warning" title="Şu anda seçilebilecek tarih yok">
            Randevu tercihi için uygun tarih bulunmuyor. Lütfen daha sonra tekrar deneyiniz veya danışmanınızla iletişime geçiniz.
          </WizNote>
        </WizardBody>
        {back ? <WizardFooter start={back} /> : null}
      </>
    );
  }

  return (
    <>
      <WizardBody>
        {intro}

        {asksCity ? (
          <div className="flex max-w-[520px] flex-col gap-2">
            <WizField
              id="cityId"
              label="Randevu şehri"
              required
              error={cityError ?? undefined}
              hint="Randevuya hangi şehirde gitmek istediğinizi seçiniz."
            >
              <Select
                id="cityId"
                value={cityId}
                onChange={(e) => {
                  setCityId(e.target.value);
                  setCityError(null);
                }}
                aria-invalid={cityError ? true : undefined}
                aria-describedby={cityError ? "cityId-hint cityId-error" : "cityId-hint"}
              >
                <option value="">Seçiniz</option>
                {cities.map((city) => (
                  <option key={city.id} value={city.id}>
                    {city.label}
                  </option>
                ))}
              </Select>
            </WizField>
            {cities.some((c) => c.hasSurcharge) ? (
              <div className="text-[13px] leading-normal text-dash-ink-3">
                <p className="font-bold text-dash-ink-2">Ücret randevu şehrine göre değişir</p>
                <p>Bazı şehirlerde randevu için ek ücret ödenir. Ek ücreti olan şehirler aşağıdaki listede tutarıyla birlikte belirtilmiştir.</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {dropped > 0 ? (
          <WizNote tone="warning">
            Daha önce seçtiğiniz {dropped} gün artık seçilebilir tarih aralığında değil. Lütfen tercihlerinizi güncelleyiniz.
          </WizNote>
        ) : null}

        {!outside ? (
          dates.length > 0 ? (
            <AvailabilityCalendar
              key="normal"
              dates={dates.map((d) => d.date)}
              selected={normal.days}
              max={MAX_PREFERENCE_COUNT}
              onToggleDay={normal.toggle}
              onSlot={normal.setSlot}
            />
          ) : (
            <WizNote tone="warning">
              Yakın tarihlerde seçilebilecek gün yok. Lütfen aşağıdaki kutuyu işaretleyerek daha ileri tarihlerden seçim yapınız.
            </WizNote>
          )
        ) : null}

        <div
          ref={outsideBoxRef}
          className={cn(
            "rounded-[20px] border-[1.5px] px-[22px] py-[18px] transition-colors motion-reduce:transition-none",
            outside ? "border-dash-navy bg-dash-selected" : "border-dash-field bg-white hover:border-dash-check",
          )}
        >
          <WizCheckbox
            id="outsideWindow"
            checked={outside}
            onChange={(e) => {
              outsideBoxTop.current = outsideBoxRef.current?.getBoundingClientRect().top ?? null;
              setOutside(e.target.checked);
              setMessage(null);
            }}
            label="Bu tarihlerin hiçbiri bana uymuyor"
            labelClassName="text-[15px] font-semibold leading-[22px]"
          />
          {outside ? (
            <p className="mt-2.5 pl-9 text-sm leading-[1.6] text-dash-ink-2">
              Üç tercih seçmeniz gerekmez. Aşağıdaki takvimde önümüzdeki aylara kadar seçilebilir iş günleri işaretlidir: boş olduğunuz{" "}
              <strong className="font-bold text-dash-navy">en fazla üç günü</strong> seçiniz, ardından her gün için tüm gün, öğleden önce
              veya öğleden sonra belirtiniz. Danışmanınız bu günleri dikkate alır.
            </p>
          ) : null}
        </div>

        {outside ? (
          <AvailabilityCalendar
            key="later"
            dates={alternativeDates.map((d) => d.date)}
            selected={later.days}
            max={MAX_ALTERNATIVE_PREFERENCES}
            onToggleDay={later.toggle}
            onSlot={later.setSlot}
          />
        ) : null}

        {message ? (
          <WizNote tone={message.tone} role={message.tone === "danger" ? "alert" : "status"}>
            {message.text}
          </WizNote>
        ) : null}
      </WizardBody>

      <WizardFooter
        start={back}
        end={
          <WizButton onClick={save} disabled={pending}>
            {pending ? "Kaydediliyor…" : saveLabel}
            {pending || !nextHref ? null : <ArrowRight aria-hidden className="size-4" strokeWidth={2.75} />}
          </WizButton>
        }
      />
    </>
  );
}
