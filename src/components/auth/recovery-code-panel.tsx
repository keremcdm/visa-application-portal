"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ArrowRight, Check, Copy, KeyRound } from "lucide-react";
import { wizButtonClass, WizCheckbox } from "@/components/customer/wizard/ui";
import { adminButton } from "@/components/staff/admin/ui";
import { createRecoveryCodeAction } from "@/server/actions/mfa";

/**
 * TWO-FACTOR AUTHENTICATION RECOVERY CODE
 * "auth": the page right after setup (styled like the sign-in screens); continues to the panel once the code is saved.
 * "admin": the person's own code in Settings → Staff; creating a new code invalidates the old one.
 * The code is only shown in this component at the moment it is created; it can never be seen again after leaving the page.
 */
export function RecoveryCodePanel({ variant, hasCode = false, continueHref }: { variant: "auth" | "admin"; hasCode?: boolean; continueHref?: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const generate = () =>
    startTransition(async () => {
      setError(null);
      setCopied(false);
      setSaved(false);
      try {
        const result = await createRecoveryCodeAction();
        if (result.ok && result.data) setCode(result.data.code);
        else setError(result.ok ? "Yedek kod oluşturulamadı. Lütfen tekrar deneyiniz." : result.message);
      } catch {
        setError("Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyiniz.");
      }
    });

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setError("Kod kopyalanamadı. Lütfen kodu elle yazınız.");
    }
  };

  const primary = variant === "auth" ? wizButtonClass("primary", "xl", "w-full") : adminButton("primary", "md");
  const secondary = variant === "auth" ? wizButtonClass("secondary", "md") : adminButton("secondary", "md");

  if (!code) {
    return (
      <div className="flex flex-col gap-3">
        {error ? (
          <p role="alert" className="text-sm font-semibold text-dash-red">
            {error}
          </p>
        ) : null}
        <div className={variant === "auth" ? "flex flex-col gap-3" : "flex flex-wrap items-center gap-3"}>
          <button type="button" onClick={generate} disabled={pending} className={primary}>
            <KeyRound aria-hidden className="size-4" strokeWidth={2.5} />
            {pending ? "Oluşturuluyor…" : variant === "auth" ? "Yedek kodumu oluştur" : hasCode ? "Yeni yedek kod oluştur" : "Yedek kod oluştur"}
          </button>
          {variant === "admin" && hasCode ? <span className="text-[13px] text-dash-ink-3">Yeni kod oluşturulunca eski kodunuz geçersiz olur.</span> : null}
        </div>
        {variant === "auth" && continueHref ? (
          <p className="text-center text-[13px] leading-[1.6] text-dash-ink-2">
            <Link href={continueHref} className="font-bold text-dash-navy underline-offset-4 hover:underline">
              Şimdilik geç
            </Link>{" "}
            — yedek kodu daha sonra Ayarlar → Personel bölümünden oluşturabilirsiniz.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-3 rounded-[18px] border border-dash-line-soft bg-white px-4 py-5">
        <span className="text-xs font-semibold text-dash-ink-3">Yedek kodunuz</span>
        <output aria-live="polite" className="break-all text-center font-mono text-lg font-extrabold tracking-[0.12em] text-dash-navy sm:text-xl">
          {code}
        </output>
        <button type="button" onClick={copy} className={secondary}>
          {copied ? <Check aria-hidden className="size-4" strokeWidth={2.75} /> : <Copy aria-hidden className="size-4" strokeWidth={2.5} />}
          {copied ? "Kopyalandı" : "Kopyala"}
        </button>
      </div>
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-[1.6] text-dash-ink-2">
        <li>
          <strong className="text-dash-navy">Bu kod bir daha gösterilmez.</strong> Bir kâğıda yazın veya parola yöneticinize kaydedin; telefonunuzda
          saklamayın.
        </li>
        <li>Telefonunuzu kaybederseniz girişte “Doğrulayıcıma erişemiyorum” bağlantısıyla bu kodu yazıp doğrulamayı yeniden kurarsınız.</li>
        <li>Kod tek kullanımlıktır; kullandıktan sonra yenisini oluşturursunuz.</li>
      </ul>
      {error ? (
        <p role="alert" className="text-sm font-semibold text-dash-red">
          {error}
        </p>
      ) : null}
      {variant === "auth" ? (
        <>
          <WizCheckbox id="recovery-saved" checked={saved} onChange={(e) => setSaved(e.target.checked)} label="Kodu güvenli bir yere kaydettim" />
          {saved && continueHref ? (
            <Link href={continueHref} className={primary}>
              Yönetim paneline geç
              <ArrowRight aria-hidden className="size-4" strokeWidth={2.75} />
            </Link>
          ) : (
            <button type="button" disabled className={primary}>
              Yönetim paneline geç
              <ArrowRight aria-hidden className="size-4" strokeWidth={2.75} />
            </button>
          )}
        </>
      ) : (
        <div>
          <button type="button" onClick={() => setCode(null)} className={secondary}>
            Kodu kaydettim, gizle
          </button>
        </div>
      )}
    </div>
  );
}
