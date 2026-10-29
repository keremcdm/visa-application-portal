"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ROUTES } from "@/lib/site";
import { submitApplicationAction } from "@/server/actions/applications";
import { WizButton, WizCheckbox, WizNote } from "./wizard/ui";

/**
 * Submits the application. Missing items are checked again on the server; submission only happens when every rule is met.
 * "Başvuru Onayları" (application confirmations): below the declaration that the information is correct, acceptance of
 * the Application Terms of Service. The boxes start unchecked; the terms open in a new tab; both are checked again on the server.
 */
export function SubmitApplication({ applicationId, blocked }: { applicationId: string; blocked: boolean }) {
  const [confirmed, setConfirmed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [error, setError] = useState<{ message: string; issues: string[] } | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      // On success the server redirects to the application page; we only come back here on error.
      const result = await submitApplicationAction(applicationId, { declaration: confirmed, terms: termsAccepted });
      if (result && !result.ok) {
        setError({ message: result.message, issues: result.fieldErrors ? Object.values(result.fieldErrors) : [] });
      }
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-4 rounded-[20px] border-[1.5px] border-dash-field px-[22px] py-[18px]">
        <legend className="px-1 text-[15px] font-bold text-dash-navy">Başvuru Onayları</legend>
        <WizCheckbox
          id="submit-confirm"
          checked={confirmed}
          disabled={blocked || pending}
          onChange={(event) => setConfirmed(event.target.checked)}
          label="Verdiğim bilgilerin doğru ve eksiksiz olduğunu, yüklediğim belgelerin bana ait veya başvurumla ilgili olduğunu beyan ederim."
        />
        <hr className="border-dash-line-soft" />
        <WizCheckbox
          id="submit-terms"
          checked={termsAccepted}
          disabled={blocked || pending}
          onChange={(event) => setTermsAccepted(event.target.checked)}
          label={
            <>
              <Link
                href={ROUTES.applicationTerms}
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-dash-navy underline underline-offset-4 hover:text-dash-red"
              >
                Başvuru Hizmet Şartları ve İptal/İade Koşulları
                <span className="sr-only"> (yeni sekmede açılır)</span>
              </Link>
              ’nı okudum, anladım ve kabul ediyorum.
            </>
          }
        />
      </fieldset>
      {error ? (
        <WizNote tone="danger" role="alert" title={error.message}>
          {error.issues.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5">
              {error.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </WizNote>
      ) : null}
      <div className="flex flex-wrap items-center gap-4">
        <WizButton variant="danger" size="xl" onClick={submit} disabled={blocked || !confirmed || !termsAccepted || pending}>
          {pending ? "Gönderiliyor…" : "Başvuruyu gönder"}
        </WizButton>
        {blocked ? <p className="text-[13px] text-dash-ink-3">Yukarıdaki eksikler tamamlandığında başvurunuzu gönderebilirsiniz.</p> : null}
      </div>
    </div>
  );
}
