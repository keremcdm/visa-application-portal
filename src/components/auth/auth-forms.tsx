"use client";

import Link from "next/link";
import { useActionState, useEffect, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { ArrowRight } from "lucide-react";
import { PasswordInput } from "@/components/customer/account/fields";
import { wizButtonClass, WizCheckbox, WizField, WizNote } from "@/components/customer/wizard/ui";
import { DateInput } from "@/components/ui/date-input";
import { describedBy, Input } from "@/components/ui/form";
import { ROUTES } from "@/lib/site";
import {
  requestPasswordResetAction,
  resendAuthEmailAction,
  signInAction,
  signUpAction,
  updatePasswordAction,
  type AuthFormState,
} from "@/server/actions/auth";
import { AuthCard, AuthDone, AuthError, AuthFooter, AuthHeading } from "./auth-layout";
import { Captcha, type CaptchaHandle } from "./captcha";
import { REGISTER_EMAIL_KEY } from "./register-link";

const IDLE: AuthFormState = { status: "idle" };

/** Each form's title, description and the redirect line below the card (provided by the page). */
type Frame = { title: string; description?: ReactNode; footer?: ReactNode };

/**
 * When leaving the page and coming back the old result (success screen or error) is not shown again. Instead of
 * unmounting visited pages Next.js hides them and keeps their state; so after signing up, reopening "Hesap oluşturun"
 * (create account) still showed the old "verify your e-mail" screen. When the page is hidden
 * the result on screen counts as "dismissed"; the result of a new submission is always shown.
 */
function useFreshOnReturn(state: AuthFormState): AuthFormState {
  const [dismissed, setDismissed] = useState<AuthFormState | null>(null);
  const latest = useRef(state);
  useLayoutEffect(() => {
    latest.current = state;
  });
  useLayoutEffect(
    () => () => {
      if (latest.current.status !== "idle") setDismissed(latest.current);
    },
    [],
  );
  return state === dismissed ? IDLE : state;
}

function errorsOf(state: AuthFormState): Record<string, string> {
  return state.status === "error" ? (state.fieldErrors ?? {}) : {};
}
function valuesOf(state: AuthFormState): Record<string, string> {
  return state.status === "error" ? (state.values ?? {}) : {};
}

function FormStatus({ state }: { state: AuthFormState }) {
  if (state.status === "error" && state.code === "account_exists") {
    return (
      <AuthError>
        {state.message}{" "}
        <Link href={ROUTES.login} className={INLINE_LINK}>
          Giriş yap
        </Link>
        {" · "}
        <Link href={ROUTES.forgotPassword} className={INLINE_LINK}>
          Şifremi unuttum
        </Link>
      </AuthError>
    );
  }
  if (state.status === "error") return <AuthError>{state.message}</AuthError>;
  if (state.status === "success") {
    return (
      <WizNote tone="success" role="status">
        {state.message}
      </WizNote>
    );
  }
  return null;
}

function NotConfigured() {
  return (
    <WizNote tone="warning" title="Sistem bağlantısı yapılandırılmadı">
      Kimlik doğrulama hizmeti (Supabase) henüz bağlanmadığı için giriş ve kayıt işlemleri şu anda yapılamaz. Kurulum adımları için proje
      klasöründeki README dosyasına bakınız.
    </WizNote>
  );
}

/** Full-width navy submit button (arrow on the right); disabled while the form is submitting. */
function AuthSubmit({ children, pendingLabel, disabled }: { children: ReactNode; pendingLabel: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} aria-disabled={pending || disabled} className={wizButtonClass("primary", "xl", "w-full")}>
      {pending ? (
        pendingLabel
      ) : (
        <>
          {children}
          <ArrowRight aria-hidden className="size-4" strokeWidth={2.75} />
        </>
      )}
    </button>
  );
}

const INLINE_LINK = "font-bold text-dash-red hover:text-dash-red-hover";

/** How long to wait before showing the button again after a resend (respects the e-mail service's limit). */
const RESEND_COOLDOWN_MS = 60_000;

/** "Bağlantıyı tekrar gönder" (resend link) on the success screen. */
function ResendLink({ kind, email }: { kind: "signup" | "recovery"; email: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const captcha = useRef<CaptchaHandle>(null);
  const cooling = result?.ok === true;

  useEffect(() => {
    if (!cooling) return;
    const timer = window.setTimeout(() => setResult(null), RESEND_COOLDOWN_MS);
    return () => window.clearTimeout(timer);
  }, [cooling]);

  const resend = () =>
    startTransition(async () => {
      try {
        setResult(await resendAuthEmailAction(kind, email, captcha.current?.token()));
      } catch {
        setResult({ ok: false, message: "Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyiniz." });
      }
    });

  return (
    <div className="flex flex-col items-center gap-1.5">
      {cooling ? null : (
        <button
          type="button"
          onClick={resend}
          disabled={pending}
          className="text-[13px] font-bold text-dash-ink-2 underline underline-offset-[3px] hover:text-dash-navy disabled:opacity-60"
        >
          {pending ? "Gönderiliyor…" : "Bağlantıyı tekrar gönder"}
        </button>
      )}
      <Captcha ref={captcha} resetKey={result} />
      {result ? (
        <p role={result.ok ? "status" : "alert"} className={result.ok ? "text-[13px] font-semibold text-dash-green-ink" : "text-[13px] font-semibold text-dash-red"}>
          {result.message}
        </p>
      ) : null}
    </div>
  );
}

export function SignInForm({
  configured,
  next,
  notice,
  lastEmail,
  title,
  description,
  footer,
}: Frame & {
  configured: boolean;
  next?: string;
  notice?: { text: string; tone: "warning" | "success" };
  /** E-mail address of the last successful sign-in in this browser; only used to prefill the field. */
  lastEmail?: string;
}) {
  const [submitted, action] = useActionState(signInAction, IDLE);
  const state = useFreshOnReturn(submitted);
  const values = valuesOf(state);
  return (
    <>
      <AuthCard>
        <AuthHeading title={title} description={description} />
        <form action={action} noValidate className="flex flex-col gap-6">
          {!configured ? <NotConfigured /> : null}
          {notice && state.status === "idle" ? (
            <WizNote tone={notice.tone} role="status">
              {notice.text}
            </WizNote>
          ) : null}
          <FormStatus state={state} />
          {next ? <input type="hidden" name="next" value={next} /> : null}
          <div className="flex flex-col gap-[18px]">
            <WizField id="email" label="E-posta adresi" required>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                defaultValue={values.email ?? lastEmail}
                disabled={!configured}
              />
            </WizField>
            <WizField
              id="password"
              label="Şifre"
              required
              labelExtra={
                <Link href={ROUTES.forgotPassword} className={`ml-auto text-[13px] ${INLINE_LINK}`}>
                  Şifremi unuttum
                </Link>
              }
            >
              <PasswordInput id="password" name="password" autoComplete="current-password" required disabled={!configured} />
            </WizField>
          </div>
          <WizCheckbox id="remember" name="remember" defaultChecked={values.remember === "on"} disabled={!configured} label="Beni hatırla" />
          <Captcha resetKey={state} />
          <AuthSubmit pendingLabel="Giriş yapılıyor…" disabled={!configured}>
            Giriş yap
          </AuthSubmit>
        </form>
      </AuthCard>
      {footer ? <AuthFooter>{footer}</AuthFooter> : null}
    </>
  );
}

export function SignUpForm({ configured, title, description, footer }: Frame & { configured: boolean }) {
  const [submitted, action] = useActionState(signUpAction, IDLE);
  const state = useFreshOnReturn(submitted);
  const errors = errorsOf(state);
  const values = valuesOf(state);
  const emailInput = useRef<HTMLInputElement>(null);

  // An e-mail typed on the sign-in screen (RegisterLink) is carried over to the sign-up form; deleted after reading.
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(REGISTER_EMAIL_KEY);
      sessionStorage.removeItem(REGISTER_EMAIL_KEY);
      if (stored && emailInput.current && emailInput.current.value === "") emailInput.current.value = stored;
    } catch {
      // If storage is unavailable the form opens empty.
    }
  }, []);

  if (state.status === "success") {
    return (
      <AuthCard wide>
        <AuthDone title={title} message={state.message} extra={state.email ? <ResendLink kind="signup" email={state.email} /> : null} />
      </AuthCard>
    );
  }

  return (
    <>
      <AuthCard wide>
        <AuthHeading title={title} description={description} />
        <form action={action} noValidate className="flex flex-col gap-6">
          {!configured ? <NotConfigured /> : null}
          <FormStatus state={state} />
          <div className="grid gap-x-3.5 gap-y-[18px] sm:grid-cols-2">
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
                disabled={!configured}
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
                disabled={!configured}
              />
            </WizField>
            <WizField id="email" label="E-posta adresi" required error={errors.email} className="sm:col-span-2">
              <Input
                ref={emailInput}
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                defaultValue={values.email}
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={describedBy("email", null, errors.email)}
                disabled={!configured}
              />
            </WizField>
            <WizField id="birthDate" label="Doğum tarihi" required error={errors.birthDate} className="sm:col-span-2">
              <DateInput
                id="birthDate"
                name="birthDate"
                autoComplete="bday"
                required
                min="1900-01-01"
                max="today"
                defaultValue={values.birthDate}
                aria-invalid={errors.birthDate ? true : undefined}
                aria-describedby={describedBy("birthDate", null, errors.birthDate)}
                disabled={!configured}
              />
            </WizField>
            <WizField id="password" label="Şifre" required error={errors.password} hint="En az 8 karakter; en az bir harf ve bir rakam içermelidir.">
              <PasswordInput
                id="password"
                name="password"
                autoComplete="new-password"
                required
                minLength={8}
                aria-invalid={errors.password ? true : undefined}
                aria-describedby={describedBy("password", true, errors.password)}
                disabled={!configured}
              />
            </WizField>
            <WizField id="passwordConfirm" label="Şifre (tekrar)" required error={errors.passwordConfirm}>
              <PasswordInput
                id="passwordConfirm"
                name="passwordConfirm"
                autoComplete="new-password"
                required
                aria-invalid={errors.passwordConfirm ? true : undefined}
                aria-describedby={describedBy("passwordConfirm", null, errors.passwordConfirm)}
                disabled={!configured}
              />
            </WizField>
          </div>
          <WizCheckbox
            id="consent"
            name="consent"
            required
            disabled={!configured}
            error={errors.consent}
            // The consent is only for the KVKK privacy notice; the site has no Privacy Policy or Terms of Use.
            label={
              <>
                <Link href={ROUTES.kvkk} target="_blank" className={INLINE_LINK}>
                  KVKK Aydınlatma Metni
                </Link>
                ’ni okudum.
              </>
            }
          />
          <Captcha resetKey={state} />
          <AuthSubmit pendingLabel="Hesap oluşturuluyor…" disabled={!configured}>
            Hesap oluştur
          </AuthSubmit>
        </form>
      </AuthCard>
      {footer ? <AuthFooter>{footer}</AuthFooter> : null}
    </>
  );
}

export function ForgotPasswordForm({ configured, title, description, footer }: Frame & { configured: boolean }) {
  const [submitted, action] = useActionState(requestPasswordResetAction, IDLE);
  const state = useFreshOnReturn(submitted);
  const errors = errorsOf(state);

  if (state.status === "success") {
    return (
      <AuthCard>
        <AuthDone title={title} message={state.message} extra={state.email ? <ResendLink kind="recovery" email={state.email} /> : null} />
      </AuthCard>
    );
  }

  return (
    <>
      <AuthCard>
        <AuthHeading title={title} description={description} />
        <form action={action} noValidate className="flex flex-col gap-6">
          {!configured ? <NotConfigured /> : null}
          <FormStatus state={state} />
          <WizField id="email" label="E-posta adresi" required error={errors.email}>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              defaultValue={valuesOf(state).email}
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={describedBy("email", null, errors.email)}
              disabled={!configured}
            />
          </WizField>
          <Captcha resetKey={state} />
          <AuthSubmit pendingLabel="Gönderiliyor…" disabled={!configured}>
            Sıfırlama bağlantısı gönder
          </AuthSubmit>
        </form>
      </AuthCard>
      {footer ? <AuthFooter>{footer}</AuthFooter> : null}
    </>
  );
}

export function ResetPasswordForm({ configured, title, description }: Frame & { configured: boolean }) {
  const [state, action] = useActionState(updatePasswordAction, IDLE);
  const errors = errorsOf(state);
  return (
    <AuthCard>
      <AuthHeading title={title} description={description} />
      <form action={action} noValidate className="flex flex-col gap-6">
        {!configured ? <NotConfigured /> : null}
        <FormStatus state={state} />
        <div className="flex flex-col gap-[18px]">
          <WizField id="password" label="Yeni şifre" required error={errors.password} hint="En az 8 karakter; en az bir harf ve bir rakam içermelidir.">
            <PasswordInput
              id="password"
              name="password"
              autoComplete="new-password"
              required
              minLength={8}
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={describedBy("password", true, errors.password)}
              disabled={!configured}
            />
          </WizField>
          <WizField id="passwordConfirm" label="Yeni şifre (tekrar)" required error={errors.passwordConfirm}>
            <PasswordInput
              id="passwordConfirm"
              name="passwordConfirm"
              autoComplete="new-password"
              required
              aria-invalid={errors.passwordConfirm ? true : undefined}
              aria-describedby={describedBy("passwordConfirm", null, errors.passwordConfirm)}
              disabled={!configured}
            />
          </WizField>
        </div>
        <AuthSubmit pendingLabel="Kaydediliyor…" disabled={!configured}>
          Şifreyi kaydet
        </AuthSubmit>
      </form>
    </AuthCard>
  );
}
