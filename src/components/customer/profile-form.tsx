"use client";

import { useActionState } from "react";
import { WizField, WizNote } from "@/components/customer/wizard/ui";
import { DateInput } from "@/components/ui/date-input";
import { describedBy, Input } from "@/components/ui/form";
import { updateProfileAction, type ProfileFormState } from "@/server/actions/profile";
import { SavedPill } from "./account/account-section";
import { WizSubmitButton } from "./account/fields";

const IDLE: ProfileFormState = { status: "idle" };

export type ProfileValues = { firstName: string; lastName: string; birthDate: string };

/** Personal details form on the "Hesabım" (My Account) page. */
export function ProfileForm({ initial, today }: { initial: ProfileValues; today: string }) {
  const [state, formAction] = useActionState(updateProfileAction, IDLE);
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  // On error the values the customer typed are kept; on success the current values from the server are shown.
  const values = state.status === "error" ? state.values : initial;
  // So the fields are recreated with the new values after a successful save.
  const formKey = state.status === "success" ? `${initial.firstName}|${initial.lastName}|${initial.birthDate}` : "form";

  return (
    <form key={formKey} action={formAction} noValidate className="flex flex-col gap-5">
      {state.status === "error" ? (
        <WizNote tone="danger" role="alert">
          {state.message}
        </WizNote>
      ) : null}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-5">
        <WizField id="firstName" label="Ad" required error={errors.firstName}>
          <Input
            id="firstName"
            name="firstName"
            autoComplete="given-name"
            required
            maxLength={80}
            defaultValue={values.firstName}
            aria-invalid={errors.firstName ? true : undefined}
            aria-describedby={describedBy("firstName", null, errors.firstName)}
          />
        </WizField>
        <WizField id="lastName" label="Soyad" required error={errors.lastName}>
          <Input
            id="lastName"
            name="lastName"
            autoComplete="family-name"
            required
            maxLength={80}
            defaultValue={values.lastName}
            aria-invalid={errors.lastName ? true : undefined}
            aria-describedby={describedBy("lastName", null, errors.lastName)}
          />
        </WizField>
        <WizField id="birthDate" label="Doğum tarihi" required error={errors.birthDate}>
          <DateInput
            id="birthDate"
            name="birthDate"
            autoComplete="bday"
            required
            min="1900-01-01"
            max={today}
            defaultValue={values.birthDate}
            aria-invalid={errors.birthDate ? true : undefined}
            aria-describedby={describedBy("birthDate", null, errors.birthDate)}
          />
        </WizField>
      </div>
      <div className="flex flex-wrap items-center gap-3.5">
        <WizSubmitButton pendingLabel="Kaydediliyor…">Bilgilerimi kaydet</WizSubmitButton>
        {state.status === "success" ? <SavedPill>{state.message}</SavedPill> : null}
      </div>
    </form>
  );
}
