"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Select } from "radix-ui";
import { Input } from "@/components/ui/form";
import { cn } from "@/components/ui/primitives";
import { composePhone, parsePhone, phoneCountry, PINNED_PHONE_COUNTRIES, SORTED_PHONE_COUNTRIES } from "@/features/application-form/phone";
import type { PhoneCountry } from "@/lib/domain/phone-codes";

function Flag({ country }: { country: PhoneCountry }) {
  if (!country.flag) return <span aria-hidden className="inline-block h-[14px] w-[21px] shrink-0 rounded-[2px] bg-slate-200" />;
  // The flag is only a visual aid; the country name and code are also written as text.
  // eslint-disable-next-line @next/next/no-img-element -- small, fixed SVG; no image optimization needed
  return <img src={`/flags/${country.iso2.toLowerCase()}.svg`} alt="" width={21} height={14} className="h-[14px] w-[21px] shrink-0 rounded-[2px] object-cover ring-1 ring-black/10" />;
}

function CountryItem({ country }: { country: PhoneCountry }) {
  return (
    <Select.Item
      value={country.iso2}
      textValue={country.name}
      className="relative flex cursor-pointer select-none items-center gap-2.5 rounded-[10px] py-2 pl-2 pr-8 text-sm text-dash-ink outline-none data-[highlighted]:bg-dash-subtle data-[highlighted]:text-dash-navy"
    >
      <Flag country={country} />
      <Select.ItemText>{country.name}</Select.ItemText>
      <span className="ml-auto pl-2 tabular-nums text-dash-ink-3">{country.dialCode}</span>
      <Select.ItemIndicator className="absolute right-2 inline-flex">
        <Check aria-hidden className="size-4" />
      </Select.ItemIndicator>
    </Select.Item>
  );
}

/**
 * Phone number: country code list with flags + number field.
 * The value is stored as a single string: "+90 532 123 45 67". Türkiye and the United Kingdom are at the top of the list.
 */
export function PhoneInput({
  id,
  name,
  label,
  value,
  onChange,
  required,
  invalid,
  describedById,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  invalid: boolean;
  describedById: string | undefined;
}) {
  const parsed = parsePhone(value);
  const [chosen, setChosen] = useState(parsed.iso2);
  // If the stored number's code differs from the selected country's (e.g. filled in from elsewhere), the stored code wins.
  const country = phoneCountry(parsed.dialCode !== null && phoneCountry(chosen).dialCode !== parsed.dialCode ? parsed.iso2 : chosen);

  return (
    <div className="flex gap-2">
      <Select.Root
        value={country.iso2}
        onValueChange={(iso2) => {
          setChosen(iso2);
          onChange(composePhone(phoneCountry(iso2), parsed.national));
        }}
      >
        <Select.Trigger
          id={`${id}-country`}
          aria-label={`${label}: ülke kodu`}
          className={cn("field-control flex w-auto shrink-0 items-center gap-2 pr-2 tabular-nums", invalid && "border-accent-600")}
        >
          <Select.Value>
            <span className="flex items-center gap-2">
              <Flag country={country} />
              {country.dialCode}
            </span>
          </Select.Value>
          <Select.Icon>
            <ChevronDown aria-hidden className="size-4 text-dash-ink-3" strokeWidth={2.75} />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            position="popper"
            sideOffset={4}
            align="start"
            className="z-50 max-h-[min(22rem,var(--radix-select-content-available-height))] w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-[14px] border border-dash-line bg-white font-dash shadow-lg"
          >
            <Select.Viewport className="p-1">
              <Select.Group>
                {PINNED_PHONE_COUNTRIES.map((c) => (
                  <CountryItem key={c.iso2} country={c} />
                ))}
              </Select.Group>
              <Select.Separator className="my-1 h-px bg-dash-line-soft" />
              <Select.Group>
                {SORTED_PHONE_COUNTRIES.map((c) => (
                  <CountryItem key={c.iso2} country={c} />
                ))}
              </Select.Group>
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
      <Input
        id={id}
        name={name}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        required={required}
        // The selected country's sample number is shown greyed out.
        placeholder={country.example || undefined}
        value={parsed.national}
        onChange={(e) => onChange(composePhone(country, e.target.value))}
        aria-invalid={invalid || undefined}
        aria-describedby={describedById}
        className="min-w-0 flex-1"
      />
    </div>
  );
}
