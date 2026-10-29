"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowRight } from "lucide-react";
import { Select } from "@/components/ui/form";
import { callAction, isOffline, OFFLINE_MESSAGE } from "@/components/ui/network";
import { cn } from "@/components/ui/primitives";
import {
  APPLICATION_TYPE_DESCRIPTIONS,
  APPLICATION_TYPE_LABELS,
  APPLICATION_TYPES,
  SPONSOR_STATUS_LABELS,
  SPONSOR_STATUSES,
  type ApplicationType,
} from "@/lib/domain/constants";
import { saveApplicationSetupAction } from "@/server/actions/applications";
import { WizardBody, WizardFooter, WizButton, WizField, WizNote } from "./wizard/ui";

export function SetupForm({
  applicationId,
  initialTypes,
  initialSponsorStatus,
  nextHref,
}: {
  applicationId: string;
  initialTypes: ApplicationType[];
  initialSponsorStatus: string | null;
  nextHref: string;
}) {
  const router = useRouter();
  const [types, setTypes] = useState<ApplicationType[]>(initialTypes);
  const [sponsorStatus, setSponsorStatus] = useState(initialSponsorStatus ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sponsored = types.includes("sponsored");

  const toggle = (type: ApplicationType) => {
    setTypes((current) => (current.includes(type) ? current.filter((t) => t !== type) : [...current, type]));
  };

  const submit = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await callAction(() =>
        saveApplicationSetupAction(applicationId, {
          applicationTypes: types,
          sponsorStatus: sponsored ? sponsorStatus || null : null,
        }),
      );
      if (!result.ok) {
        setErrors(("fieldErrors" in result ? result.fieldErrors : undefined) ?? {});
        setMessage(result.message);
        return;
      }
      setErrors({});
      // While offline the next page cannot load; stay on this page instead of landing on the browser's error page.
      if (isOffline()) setMessage(`Seçiminiz kaydedildi ancak sonraki adıma geçilemedi. ${OFFLINE_MESSAGE}`);
      else router.push(nextHref);
    });
  };

  return (
    <form
      noValidate
      className="flex flex-1 flex-col"
      // Prevents the browser from submitting with GET (writing to the URL) if the form is sent before the page is interactive.
      action={() => submit()}
    >
      <WizardBody className="gap-[22px]">
        {message ? (
          <WizNote tone="danger" role="alert">
            {message}
          </WizNote>
        ) : null}

        <fieldset aria-describedby={errors.applicationTypes ? "types-error" : "types-hint"}>
          <legend className="text-base font-bold">Size uyan başvuru tipini seçiniz</legend>
          <p id="types-hint" className="mt-1.5 max-w-[720px] text-sm leading-[1.6] text-dash-ink-2 [text-wrap:pretty]">
            Durumunuza uyan birden fazla seçeneği işaretleyebilirsiniz (örneğin öğrenci ve sponsorlu). İstenen evraklar seçiminize göre
            belirlenir.
          </p>
          <div className="mt-[22px] grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-3">
            {APPLICATION_TYPES.map((type) => {
              const checked = types.includes(type);
              return (
                <label
                  key={type}
                  className={cn(
                    "flex cursor-pointer items-start gap-4 rounded-[20px] border-[1.5px] px-[22px] py-5 transition-colors motion-reduce:transition-none",
                    checked ? "border-dash-navy bg-dash-selected" : "border-dash-field bg-white hover:border-dash-check",
                  )}
                >
                  <input type="checkbox" className="wiz-check mt-px" checked={checked} onChange={() => toggle(type)} />
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="text-[15px] font-bold text-dash-navy">{APPLICATION_TYPE_LABELS[type]}</span>
                    <span className="text-[13px] leading-normal text-dash-ink-2">{APPLICATION_TYPE_DESCRIPTIONS[type]}</span>
                  </span>
                </label>
              );
            })}
          </div>
          {errors.applicationTypes ? (
            <p id="types-error" className="mt-3 text-[13px] font-semibold text-dash-red">
              {errors.applicationTypes}
            </p>
          ) : null}
        </fieldset>

        {sponsored ? (
          <WizField
            id="sponsorStatus"
            label="Sponsorunuzun çalışma durumu"
            required
            error={errors.sponsorStatus}
            hint="Sponsorunuzdan istenecek belgeler bu seçime göre belirlenir."
            className="max-w-[520px]"
          >
            <Select
              id="sponsorStatus"
              value={sponsorStatus}
              onChange={(e) => setSponsorStatus(e.target.value)}
              aria-invalid={errors.sponsorStatus ? true : undefined}
              aria-describedby={errors.sponsorStatus ? "sponsorStatus-hint sponsorStatus-error" : "sponsorStatus-hint"}
            >
              <option value="">Seçiniz</option>
              {SPONSOR_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {SPONSOR_STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
          </WizField>
        ) : null}
      </WizardBody>

      <WizardFooter
        start={
          <span className="text-[13px] text-dash-ink-3">{types.length > 0 ? `${types.length} başvuru tipi seçildi` : "En az bir başvuru tipi seçiniz"}</span>
        }
        end={
          <WizButton type="submit" disabled={pending}>
            {pending ? "Kaydediliyor…" : "Kaydet ve devam et"}
            {pending ? null : <ArrowRight aria-hidden className="size-4" strokeWidth={2.75} />}
          </WizButton>
        }
      />
    </form>
  );
}
