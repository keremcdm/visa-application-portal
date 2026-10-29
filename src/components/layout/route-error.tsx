"use client";

import { ERROR_PRIMARY, ErrorCard } from "./error-card";

/** Error screen shown when page data cannot be loaded. No technical details are shown to the user. */
export function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="py-10">
      <ErrorCard
        code="!"
        tone="red"
        title="Sayfa yüklenemedi"
        actions={
          <button type="button" className={ERROR_PRIMARY} onClick={() => retry()}>
            Tekrar dene
          </button>
        }
        footnote={error.digest ? `Hata kodu: ${error.digest}` : undefined}
      >
        <p>Bilgiler alınırken bir sorun oluştu. Verileriniz güvende; lütfen tekrar deneyiniz.</p>
      </ErrorCard>
    </div>
  );
}
