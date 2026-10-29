"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Alert, Button, cn } from "@/components/ui/primitives";
import { isCompleteDownload } from "@/features/export/stream";

type Failure = { label: string; zipPath: string; reason: string };

type State =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "done"; fileName: string; included: number; missing: number }
  | { kind: "error"; message: string; failures: Failure[]; canForce: boolean };

function fileNameFrom(disposition: string | null): string {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition ?? "")?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      /* fall back to the plain name */
    }
  }
  return /filename="([^"]+)"/i.exec(disposition ?? "")?.[1] ?? "basvuru-evraklari.zip";
}

/**
 * "Tüm evrakları indir" (download all documents).
 * The ZIP is built on the server. If files are missing the download does NOT START and the missing items are listed;
 * the consultant can explicitly confirm a download with the missing items.
 * `buttonClassName` / `label` / `floating`: for the "Tüm evraklar (ZIP)" button in the admin panel header;
 * the result box opens below the button without shifting the page layout.
 */
export function ExportButton({
  applicationId,
  buttonClassName,
  label = "Tüm evrakları indir",
  floating = false,
}: {
  applicationId: string;
  buttonClassName?: string;
  label?: string;
  floating?: boolean;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });

  const download = async (allowPartial: boolean) => {
    setState({ kind: "working" });
    try {
      const response = await fetch(`/api/admin/applications/${applicationId}/export${allowPartial ? "?partial=1" : ""}`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });

      if (!response.ok) {
        let body: { message?: string; failures?: Failure[]; reason?: string } = {};
        try {
          body = await response.json();
        } catch {
          /* body is not JSON */
        }
        setState({
          kind: "error",
          message: body.message ?? "ZIP dosyası oluşturulamadı. Lütfen tekrar deneyiniz.",
          failures: Array.isArray(body.failures) ? body.failures : [],
          canForce: response.status === 409 && body.reason === "missing_files" && !allowPartial,
        });
        return;
      }

      const blob = await response.blob();
      if (!isCompleteDownload(response.headers.get("X-Export-Size"), blob.size)) {
        setState({
          kind: "error",
          message: "ZIP dosyası eksik indi (bağlantı yarıda kesilmiş olabilir). Dosya kaydedilmedi; lütfen tekrar deneyiniz.",
          failures: [],
          canForce: false,
        });
        return;
      }
      const fileName = fileNameFrom(response.headers.get("Content-Disposition"));
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);

      setState({
        kind: "done",
        fileName,
        included: Number(response.headers.get("X-Export-Included") ?? 0),
        missing: Number(response.headers.get("X-Export-Missing") ?? 0),
      });
    } catch {
      setState({ kind: "error", message: "Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyiniz.", failures: [], canForce: false });
    }
  };

  return (
    <div className={cn(floating && "relative")}>
      {buttonClassName ? (
        <button type="button" className={buttonClassName} onClick={() => void download(false)} disabled={state.kind === "working"}>
          <Download aria-hidden className="size-4" strokeWidth={2.5} />
          {state.kind === "working" ? "ZIP hazırlanıyor…" : label}
        </button>
      ) : (
        <Button onClick={() => void download(false)} disabled={state.kind === "working"}>
          <Download aria-hidden className="size-4" />
          {state.kind === "working" ? "ZIP hazırlanıyor…" : label}
        </Button>
      )}

      <div
        aria-live="polite"
        className={cn(
          floating ? "absolute right-0 top-full z-20 mt-2 w-[min(380px,calc(100vw-2rem))] empty:hidden [&>*]:shadow-[0_12px_32px_color-mix(in_srgb,var(--color-dash-navy)_18%,transparent)]" : "mt-3",
        )}
      >
        {state.kind === "working" ? <p className={cn("text-sm text-muted", floating && "rounded-[14px] border border-dash-line bg-white px-3.5 py-2.5")}>Dosyalar toplanıyor; bu işlem dosya sayısına göre biraz sürebilir.</p> : null}

        {state.kind === "done" ? (
          <Alert tone={state.missing > 0 ? "warning" : "success"} role="status" title={state.missing > 0 ? "ZIP eksik dosyalarla indirildi" : "ZIP indirildi"}>
            <p>
              <span className="font-medium">{state.fileName}</span> — {state.included} dosya eklendi
              {state.missing > 0 ? `, ${state.missing} dosya eklenemedi. Eksiklerin listesi arşivdeki EKSIK_DOSYALAR_RAPORU.txt dosyasındadır.` : "."}
            </p>
          </Alert>
        ) : null}

        {state.kind === "error" ? (
          <Alert tone="danger" role="alert" title={state.message}>
            {state.failures.length > 0 ? (
              <>
                <p className="mb-2">Eklenemeyen dosyalar:</p>
                <ul className="list-disc space-y-1 pl-5">
                  {state.failures.map((failure, index) => (
                    <li key={index}>
                      <span className="font-medium">{failure.label}</span> — {failure.reason}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {state.canForce ? (
              <div className="mt-3">
                <Button variant="danger" size="sm" onClick={() => void download(true)}>
                  Eksik dosyalar olmadan yine de indir
                </Button>
              </div>
            ) : null}
          </Alert>
        ) : null}
        {floating && (state.kind === "done" || state.kind === "error") ? (
          <button type="button" className="mt-2 inline-flex h-8 items-center rounded-full border border-dash-line bg-white px-3 text-[13px] font-bold text-dash-navy hover:bg-dash-subtle" onClick={() => setState({ kind: "idle" })}>
            Kapat
          </button>
        ) : null}
      </div>
    </div>
  );
}
