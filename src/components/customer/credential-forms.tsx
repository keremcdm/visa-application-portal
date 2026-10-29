"use client";

import { useActionState } from "react";
import { WizField, WizNote } from "@/components/customer/wizard/ui";
import { describedBy, Input } from "@/components/ui/form";
import { Captcha } from "@/components/auth/captcha";
import { changeEmailAction, changePasswordAction, type CredentialFormState } from "@/server/actions/profile";
import { SavedPill } from "./account/account-section";
import { PasswordInput, WizSubmitButton } from "./account/fields";

const IDLE: CredentialFormState = { status: "idle" };

function ErrorNote({ state }: { state: CredentialFormState }) {
  return state.status === "error" ? (
    <WizNote tone="danger" role="alert">
      {state.message}
    </WizNote>
  ) : null;
}

/**
 * My Account → e-mail change: new address + current password; the change happens once the link in the e-mail is confirmed.
 * The note about the address awaiting confirmation is shown on the page under the section title (so it is visible while the section is closed).
 */
export function EmailChangeForm({ currentEmail }: { currentEmail: string }) {
  const [state, formAction] = useActionState(changeEmailAction, IDLE);
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const values = state.status === "error" ? (state.values ?? {}) : {};
  return (
    // The form is recreated after a successful submission so the fields are cleared.
    <form key={state.status === "success" ? "sent" : "form"} action={formAction} noValidate className="flex flex-col gap-5">
      <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-[16px] bg-dash-canvas px-4 py-3 text-sm">
        <span className="text-dash-ink-2">Şu anki adresiniz:</span> <strong className="min-w-0 break-all font-extrabold">{currentEmail}</strong>
      </p>
      <ErrorNote state={state} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-5">
        <WizField id="newEmail" label="Yeni e-posta adresi" required error={errors.newEmail}>
          <Input
            id="newEmail"
            name="newEmail"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            maxLength={254}
            defaultValue={values.newEmail}
            aria-invalid={errors.newEmail ? true : undefined}
            aria-describedby={describedBy("newEmail", null, errors.newEmail)}
          />
        </WizField>
        <WizField id="emailCurrentPassword" label="Mevcut şifreniz" required error={errors.currentPassword} hint="Güvenliğiniz için gereklidir.">
          <PasswordInput
            id="emailCurrentPassword"
            name="currentPassword"
            autoComplete="current-password"
            required
            aria-invalid={errors.currentPassword ? true : undefined}
            aria-describedby={describedBy("emailCurrentPassword", true, errors.currentPassword)}
          />
        </WizField>
      </div>
      {/* The token is single-use: a new one is requested after every submission. */}
      <Captcha resetKey={state} />
      <div className="flex flex-wrap items-center gap-3.5">
        <WizSubmitButton pendingLabel="Gönderiliyor…">Doğrulama bağlantısı gönder</WizSubmitButton>
        {state.status === "success" ? <SavedPill>{state.message}</SavedPill> : null}
      </div>
    </form>
  );
}

/** My Account → password change: current password + new password (twice). */
export function PasswordChangeForm() {
  const [state, formAction] = useActionState(changePasswordAction, IDLE);
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  return (
    // Passwords are never written back into the form; the fields are cleared after every submission.
    <form key={state.status === "idle" ? "idle" : `${state.status}-${state.message}`} action={formAction} noValidate className="flex flex-col gap-5">
      <ErrorNote state={state} />
      <div className="grid gap-5 sm:grid-cols-2">
        <WizField id="currentPassword" label="Mevcut şifreniz" required error={errors.currentPassword} className="sm:col-span-2 sm:max-w-[calc(50%-10px)]">
          <PasswordInput
            id="currentPassword"
            name="currentPassword"
            autoComplete="current-password"
            required
            aria-invalid={errors.currentPassword ? true : undefined}
            aria-describedby={describedBy("currentPassword", null, errors.currentPassword)}
          />
        </WizField>
        <WizField id="newPassword" label="Yeni şifre" required error={errors.newPassword} hint="En az 8 karakter; en az bir harf ve bir rakam içermelidir.">
          <PasswordInput
            id="newPassword"
            name="newPassword"
            autoComplete="new-password"
            required
            minLength={8}
            aria-invalid={errors.newPassword ? true : undefined}
            aria-describedby={describedBy("newPassword", true, errors.newPassword)}
          />
        </WizField>
        <WizField id="newPasswordConfirm" label="Yeni şifre (tekrar)" required error={errors.newPasswordConfirm}>
          <PasswordInput
            id="newPasswordConfirm"
            name="newPasswordConfirm"
            autoComplete="new-password"
            required
            aria-invalid={errors.newPasswordConfirm ? true : undefined}
            aria-describedby={describedBy("newPasswordConfirm", null, errors.newPasswordConfirm)}
          />
        </WizField>
      </div>
      {/* The token is single-use: a new one is requested after every submission. */}
      <Captcha resetKey={state} />
      <div className="flex flex-wrap items-center gap-3.5">
        <WizSubmitButton pendingLabel="Değiştiriliyor…">Şifremi değiştir</WizSubmitButton>
        {state.status === "success" ? <SavedPill>{state.message}</SavedPill> : null}
      </div>
    </form>
  );
}
