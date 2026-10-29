"use client";

import Image from "next/image";
import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { ArrowRight, LogOut, ShieldCheck } from "lucide-react";
import { wizButtonClass, WizField } from "@/components/customer/wizard/ui";
import { describedBy, Input } from "@/components/ui/form";
import { signOutAction } from "@/server/actions/auth";
import { redeemRecoveryCodeAction, startMfaEnrollmentAction, verifyMfaAction, type EnrollmentInfo, type MfaFormState } from "@/server/actions/mfa";
import { AuthCard, AuthError, AuthFooter, AuthHeading } from "./auth-layout";

/*
 * TWO-FACTOR AUTHENTICATION PAGE FOR STAFF
 * "enroll": the authenticator app is set up for the first time (QR code or key, then a 6-digit code).
 * "verify": the 6-digit code from the app is required at every sign-in.
 */

const IDLE: MfaFormState = { status: "idle" };

function Submit({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-disabled={pending} className={wizButtonClass("primary", "xl", "w-full")}>
      {pending ? (
        "Doğrulanıyor…"
      ) : (
        <>
          {children}
          <ArrowRight aria-hidden className="size-4" strokeWidth={2.75} />
        </>
      )}
    </button>
  );
}

function CodeForm({ factorId, submitLabel }: { factorId: string | null; submitLabel: string }) {
  const [state, action] = useActionState(verifyMfaAction, IDLE);
  const error = state.status === "error" ? state.message : null;
  return (
    <form action={action} noValidate className="flex flex-col gap-5">
      {factorId ? <input type="hidden" name="factorId" value={factorId} /> : null}
      <WizField id="mfa-code" label="Doğrulama kodu" required hint="Uygulamada görünen 6 haneli kod (30 saniyede bir değişir)." error={error}>
        <Input
          id="mfa-code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          required
          className="text-center text-lg font-bold tracking-[0.4em]"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy("mfa-code", true, error)}
        />
      </WizField>
      <Submit>{submitLabel}</Submit>
    </form>
  );
}

/** Recovery code entry for staff who cannot access their authenticator. */
function RecoveryForm({ onCancel }: { onCancel: () => void }) {
  const [state, action] = useActionState(redeemRecoveryCodeAction, IDLE);
  const error = state.status === "error" ? state.message : null;
  return (
    <form action={action} noValidate className="flex flex-col gap-5">
      <p className="text-sm leading-[1.6] text-dash-ink-2">
        Kurulumda kaydettiğiniz yedek kodu yazınız. Kod doğruysa eski doğrulama uygulaması kaydınız kaldırılır ve iki adımlı doğrulamayı yeni
        telefonunuzla yeniden kurarsınız. Yedek kod tek kullanımlıktır.
      </p>
      <WizField id="recovery-code" label="Yedek kod" required hint="20 karakter, ör. K7Q4-9MZD-X2PH-RT6W-8BNC (tireler ve büyük-küçük harf fark etmez)." error={error}>
        <Input
          id="recovery-code"
          name="recoveryCode"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={40}
          required
          className="text-center font-mono text-base font-bold tracking-[0.12em] uppercase"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy("recovery-code", true, error)}
        />
      </WizField>
      <Submit>Yedek kodla devam et</Submit>
      <button type="button" onClick={onCancel} className="text-sm font-bold text-dash-navy underline-offset-4 hover:underline">
        Doğrulama koduyla gir
      </button>
    </form>
  );
}

export function MfaForm({ mode, email }: { mode: "enroll" | "verify"; email: string }) {
  const [recovering, setRecovering] = useState(false);
  const [enrollment, setEnrollment] = useState<EnrollmentInfo | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, startTransition] = useTransition();

  const start = () =>
    startTransition(async () => {
      setStartError(null);
      try {
        const result = await startMfaEnrollmentAction();
        if (result.ok && result.data) setEnrollment(result.data);
        else setStartError(result.ok ? "Kurulum başlatılamadı. Lütfen tekrar deneyiniz." : result.message);
      } catch {
        setStartError("Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyiniz.");
      }
    });

  return (
    <>
      <AuthCard wide={mode === "enroll"}>
        {mode === "verify" ? (
          <>
            <AuthHeading
              title="Doğrulama kodu"
              description={
                <>
                  <strong className="text-dash-navy">{email}</strong> hesabı için telefonunuzdaki doğrulama uygulamasını açıp Vize Başvuru
                  Portalı satırındaki 6 haneli kodu yazınız.
                </>
              }
            />
            {recovering ? (
              <RecoveryForm onCancel={() => setRecovering(false)} />
            ) : (
              <>
                <CodeForm factorId={null} submitLabel="Doğrula ve devam et" />
                {/* When the code is asked again. */}
                <p className="text-[13px] leading-[1.6] text-dash-ink-2">
                  Kod her girişte bir kez sorulur. Kendi bilgisayarınızda girişte “Beni hatırla”yı işaretlerseniz, tarayıcı veya bilgisayar kapanıp
                  açılsa da “Çıkış” yapana kadar bu bilgisayarda yeniden sorulmaz. İşaretlemezseniz tarayıcı kapanınca oturum kapanır ve kod yeniden
                  sorulur.
                </p>
                {/* Recovery code. */}
                <p className="text-[13px] leading-[1.6] text-dash-ink-2">
                  Telefonunuzu veya doğrulama uygulamanızı kaybettiyseniz{" "}
                  <button type="button" onClick={() => setRecovering(true)} className="font-extrabold text-dash-red hover:text-dash-red-hover">
                    Doğrulayıcıma erişemiyorum
                  </button>{" "}
                  bağlantısıyla yedek kodunuzu kullanınız. Yedek kodunuz yoksa bir yöneticiden Ayarlar → Personel bölümünden iki adımlı
                  doğrulamanızı sıfırlamasını isteyiniz.
                </p>
              </>
            )}
          </>
        ) : (
          <>
            <AuthHeading
              title="İki adımlı doğrulamayı kurun"
              description="Yönetim paneli müşterilerin belgelerine eriştiği için girişte şifrenize ek olarak telefonunuzdaki bir doğrulama uygulamasının kodu istenir. Kurulum bir kez yapılır."
            />
            <ol className="flex flex-col gap-3 text-sm leading-[1.6] text-dash-ink-2">
              <li>
                <strong className="text-dash-navy">1.</strong> Telefonunuza bir doğrulama uygulaması kurun (ör. Google Authenticator veya Microsoft
                Authenticator).
              </li>
              <li>
                <strong className="text-dash-navy">2.</strong> Uygulamada yeni hesap ekleyip aşağıdaki karekodu okutun.
              </li>
              <li>
                <strong className="text-dash-navy">3.</strong> Uygulamanın gösterdiği 6 haneli kodu yazıp doğrulayın.
              </li>
            </ol>
            {enrollment ? (
              <>
                <div className="flex flex-col items-center gap-3 rounded-[18px] border border-dash-line-soft bg-white px-4 py-5">
                  <Image src={enrollment.qrCode} alt="Doğrulama uygulamasıyla okutulacak karekod" width={200} height={200} unoptimized />
                  <p className="text-center text-xs leading-[1.5] text-dash-ink-2">
                    Daha önce başka bir karekod okuttuysanız uygulamadaki o &quot;Vize Başvuru Portalı&quot; satırını silin: yalnızca bu
                    karekodun ürettiği kod geçerlidir.
                  </p>
                  <div className="flex w-full flex-col items-center gap-1 text-center">
                    <span className="text-xs text-dash-ink-3">Karekod okutamıyorsanız uygulamaya bu anahtarı elle yazınız:</span>
                    <code className="break-all rounded-[10px] bg-dash-subtle px-3 py-2 text-sm font-bold tracking-[0.08em] text-dash-navy">
                      {enrollment.secret}
                    </code>
                  </div>
                </div>
                <CodeForm factorId={enrollment.factorId} submitLabel="Doğrula ve kurulumu bitir" />
              </>
            ) : (
              <>
                {startError ? <AuthError>{startError}</AuthError> : null}
                <button type="button" onClick={start} disabled={starting} className={wizButtonClass("primary", "xl", "w-full")}>
                  <ShieldCheck aria-hidden className="size-4" strokeWidth={2.75} />
                  {starting ? "Hazırlanıyor…" : "Karekodu göster"}
                </button>
              </>
            )}
          </>
        )}
      </AuthCard>
      <AuthFooter>
        <form action={signOutAction}>
          <button type="submit" className="inline-flex items-center gap-1.5 font-extrabold text-dash-red hover:text-dash-red-hover">
            <LogOut aria-hidden className="size-4" strokeWidth={2.75} />
            Çıkış yap
          </button>
        </form>
      </AuthFooter>
    </>
  );
}
