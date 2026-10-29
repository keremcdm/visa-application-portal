"use client";

import { formatFileSize } from "@/lib/validation/formats";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { Download, Eye, FileText, Trash2, Upload } from "lucide-react";
import { wizButtonClass } from "@/components/customer/wizard/ui";
import { ActionButton } from "@/components/ui/action-button";
import { Button, buttonClass, cn } from "@/components/ui/primitives";
import { ACCEPT_ATTRIBUTE, ALLOWED_FORMATS_TEXT } from "@/features/documents/file-validation";
import { deleteFileAction, type UploadTarget } from "@/server/actions/documents";
import { uploadApplicationFile } from "./upload-file";

type UploadState =
  | { kind: "idle" }
  | { kind: "uploading"; name: string; index: number; total: number }
  | { kind: "error"; message: string }
  | { kind: "done"; text: string };

/** Is the dragged item a file (not text or a link)? */
const draggingFiles = (event: { dataTransfer: DataTransfer | null }) => Array.from(event.dataTransfer?.types ?? []).includes("Files");

/**
 * Look: "default" admin panel; "wizard" the outlined pill button of the application steps (right-aligned on wide screens);
 * "inline" the same button left-aligned (application status page); "dropzone" a wide dashed upload area (receipt on the
 * Fee step). Behaviour is the same.
 */
type UploadLook = "default" | "wizard" | "inline" | "dropzone";

// Formatting lives in src/lib/validation/formats.ts so server components can use it too.
export { formatFileSize };

/**
 * File upload control. Flow (for each file): get permission and a signed URL from the server -> upload the file directly
 * to storage -> have the server verify the content. Every step's error is shown clearly to the user; "uploaded" is only
 * reported after the server has verified the file. Several files can be selected and files can be dragged onto the button
 * and dropped; files are uploaded one after another, and if one is rejected the rest are
 * not uploaded and the number uploaded is reported (limits are checked again on the server for each file). The document a
 * consultant sends to the customer is a single file.
 */
export function FileUploadButton({
  applicationId,
  target,
  label,
  maxBytes,
  disabledReason,
  variant = "secondary",
  look = "default",
  className,
}: {
  applicationId: string;
  target: UploadTarget;
  label: string;
  maxBytes: number;
  disabledReason?: string | null;
  variant?: "primary" | "secondary";
  look?: UploadLook;
  /** Only for the "dropzone" look: extra classes for the area (e.g. minimum height). */
  className?: string;
}) {
  const router = useRouter();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const busy = state.kind === "uploading";
  const disabled = Boolean(disabledReason) || busy;
  const multiple = target.kind !== "staff_attachment";

  // If a file is dropped outside the button the browser must not open it and leave the page (filled-in data would be lost).
  useEffect(() => {
    const prevent = (event: globalThis.DragEvent) => {
      if (draggingFiles(event)) event.preventDefault();
    };
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  const uploadAll = async (files: File[]) => {
    if (files.length === 0 || disabled) return;
    if (!multiple && files.length > 1) {
      setState({ kind: "error", message: "Buraya tek dosya yüklenebilir. Lütfen bir dosya seçiniz." });
      return;
    }
    let uploaded = 0;
    try {
      for (const [index, file] of files.entries()) {
        setState({ kind: "uploading", name: file.name, index: index + 1, total: files.length });
        const result = await uploadApplicationFile(applicationId, target, file, maxBytes);
        if (!result.ok) {
          const rest = files.length - index - 1;
          const prefix = uploaded > 0 ? `${uploaded} dosya yüklendi. ` : "";
          const failed = files.length > 1 ? `“${file.name}” yüklenemedi: ${result.message}` : result.message;
          setState({ kind: "error", message: `${prefix}${failed}${rest > 0 ? ` Kalan ${rest} dosya yüklenmedi.` : ""}` });
          return;
        }
        uploaded += 1;
      }
      setState({ kind: "done", text: uploaded === 1 ? `“${files[0]!.name}” yüklendi.` : `${uploaded} dosya yüklendi.` });
    } finally {
      if (inputRef.current) inputRef.current.value = "";
      if (uploaded > 0) router.refresh();
    }
  };

  const dropHandlers = {
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      if (disabled || !draggingFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setDragging(true);
    },
    onDragLeave: (event: DragEvent<HTMLDivElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (event: DragEvent<HTMLDivElement>) => {
      setDragging(false);
      if (disabled || !draggingFiles(event)) return;
      event.preventDefault();
      void uploadAll(Array.from(event.dataTransfer.files));
    },
  };

  const wizardLook = look !== "default";
  const status = (
    <p
      id={`${inputId}-status`}
      className={cn(
        wizardLook ? "text-xs leading-normal" : "mt-1.5 text-sm",
        look === "wizard" && "lg:text-right",
        look === "dropzone" && "mt-2.5 text-[13px]",
      )}
      aria-live="polite"
    >
      {disabledReason ? <span className={wizardLook ? "text-dash-ink-3" : "text-muted"}>{disabledReason}</span> : null}
      {state.kind === "uploading" ? (
        <span className={wizardLook ? "text-dash-ink-3" : "text-muted"}>
          “{state.name}” yükleniyor ve doğrulanıyor{state.total > 1 ? ` (${state.index} / ${state.total})` : ""}…
        </span>
      ) : null}
      {state.kind === "done" ? <span className={wizardLook ? "font-semibold text-dash-green-ink" : "font-medium text-emerald-800"}>{state.text}</span> : null}
      {state.kind === "error" ? (
        <span role="alert" className={wizardLook ? "font-semibold text-dash-red" : "font-medium text-accent-700"}>
          {state.message}
        </span>
      ) : null}
      {state.kind === "idle" && !disabledReason ? (
        <span className={wizardLook ? (look === "dropzone" ? "text-dash-ink-3" : "text-dash-ink-4") : "text-muted"}>
          {ALLOWED_FORMATS_TEXT}, en fazla {formatFileSize(maxBytes)}.{" "}
          {multiple ? "Birden çok dosya seçebilir veya dosyaları buraya sürükleyip bırakabilirsiniz." : "Dosyayı buraya sürükleyip bırakabilirsiniz."}
        </span>
      ) : null}
    </p>
  );

  return (
    <div
      {...dropHandlers}
      className={cn(
        look === "wizard" && "flex flex-col items-start gap-2 lg:items-end",
        look === "inline" && "flex flex-col items-start gap-2",
        look === "dropzone" && "flex flex-1 flex-col",
        // The area is highlighted while a file is dragged over it (the dashed area already has a border).
        dragging && look !== "dropzone" && "rounded-[14px] outline-dashed outline-2 outline-offset-4 outline-dash-navy",
      )}
    >
      {/* The file picker is hidden; keyboard and screen reader users use the real button below. */}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        multiple={multiple}
        className="hidden"
        tabIndex={-1}
        aria-hidden
        disabled={disabled}
        onChange={(event) => {
          void uploadAll(Array.from(event.target.files ?? []));
        }}
      />
      {look === "dropzone" ? (
        <button
          type="button"
          disabled={disabled}
          aria-describedby={`${inputId}-status`}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "flex w-full flex-1 flex-col items-center justify-center gap-3.5 rounded-[24px] border-2 border-dashed border-dash-line-strong p-7 text-center transition-colors motion-reduce:transition-none hover:border-dash-navy hover:bg-dash-drop-hover disabled:opacity-60 disabled:hover:border-dash-line-strong disabled:hover:bg-transparent",
            dragging && "border-dash-navy bg-dash-drop-hover",
            className,
          )}
        >
          <span aria-hidden className="flex size-[52px] items-center justify-center rounded-full bg-dash-subtle">
            <Upload className="size-[22px] text-dash-navy" strokeWidth={2.75} />
          </span>
          <span className={wizButtonClass("secondary", "md", "pointer-events-none")}>{busy ? "Yükleniyor…" : label}</span>
        </button>
      ) : look === "wizard" || look === "inline" ? (
        <button
          type="button"
          disabled={disabled}
          aria-describedby={`${inputId}-status`}
          onClick={() => inputRef.current?.click()}
          className={wizButtonClass("secondary", "md")}
        >
          <Upload aria-hidden className="size-4" strokeWidth={2.75} />
          {busy ? "Yükleniyor…" : label}
        </button>
      ) : (
        <Button variant={variant} size="sm" disabled={disabled} aria-describedby={`${inputId}-status`} onClick={() => inputRef.current?.click()}>
          <Upload aria-hidden className="size-4" />
          {busy ? "Yükleniyor…" : label}
        </Button>
      )}
      {status}
    </div>
  );
}

export type FileItem = { id: string; originalName: string; sizeBytes: number; createdAtText: string };

/** Uploaded file row: name, size, view/download and (if allowed) delete. */
export function FileRow({
  applicationId,
  file,
  canDelete,
  showDownload = false,
  look = "default",
}: {
  applicationId: string;
  file: FileItem;
  canDelete: boolean;
  showDownload?: boolean;
  /** "wizard": the soft grey file chip in the application steps. */
  look?: "default" | "wizard";
}) {
  if (look === "wizard") {
    const action = wizButtonClass("quiet", "xs");
    return (
      <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[16px] bg-dash-canvas py-2 pl-3.5 pr-2">
        <div className="flex min-w-0 flex-[1_1_160px] items-center gap-3">
          <FileText aria-hidden className="size-[18px] flex-none text-dash-navy" strokeWidth={2.5} />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-bold text-dash-navy">{file.originalName}</p>
            <p className="text-xs text-dash-ink-3">
              {formatFileSize(file.sizeBytes)} · {file.createdAtText}
            </p>
          </div>
        </div>
        <div className="flex flex-none flex-wrap items-center gap-0.5">
          <a href={`/api/files/${file.id}`} target="_blank" rel="noopener noreferrer" className={action}>
            <Eye aria-hidden className="size-3.5" strokeWidth={2.5} />
            Görüntüle<span className="sr-only">: {file.originalName} (yeni sekmede açılır)</span>
          </a>
          {showDownload ? (
            <a href={`/api/files/${file.id}?download=1`} className={action}>
              <Download aria-hidden className="size-3.5" strokeWidth={2.5} />
              İndir<span className="sr-only">: {file.originalName}</span>
            </a>
          ) : null}
          {canDelete ? (
            <ActionButton
              buttonClassName={action}
              feedbackClassName="text-xs"
              pendingLabel="Siliniyor…"
              action={deleteFileAction.bind(null, applicationId, file.id)}
              confirm={{
                title: "Dosya silinsin mi?",
                description: `“${file.originalName}” kalıcı olarak silinecek. Bu işlem geri alınamaz.`,
                confirmLabel: "Dosyayı sil",
                tone: "delete",
              }}
            >
              <Trash2 aria-hidden className="size-3.5" strokeWidth={2.5} />
              Sil<span className="sr-only">: {file.originalName}</span>
            </ActionButton>
          ) : null}
        </div>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border border-line bg-white px-3 py-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <FileText aria-hidden className="size-5 shrink-0 text-brand-700" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{file.originalName}</p>
          <p className="text-xs text-muted">
            {formatFileSize(file.sizeBytes)} · {file.createdAtText}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <a href={`/api/files/${file.id}`} target="_blank" rel="noopener noreferrer" className={buttonClass("ghost", "sm")}>
          <Eye aria-hidden className="size-4" />
          Görüntüle<span className="sr-only">: {file.originalName} (yeni sekmede açılır)</span>
        </a>
        {showDownload ? (
          <a href={`/api/files/${file.id}?download=1`} className={buttonClass("ghost", "sm")}>
            <Download aria-hidden className="size-4" />
            İndir<span className="sr-only">: {file.originalName}</span>
          </a>
        ) : null}
        {canDelete ? (
          <ActionButton
            variant="ghost"
            size="sm"
            pendingLabel="Siliniyor…"
            action={deleteFileAction.bind(null, applicationId, file.id)}
            confirm={{
              title: "Dosya silinsin mi?",
              description: `“${file.originalName}” kalıcı olarak silinecek. Bu işlem geri alınamaz.`,
              confirmLabel: "Dosyayı sil",
                tone: "delete",
            }}
          >
            <Trash2 aria-hidden className="size-4" />
            Sil<span className="sr-only">: {file.originalName}</span>
          </ActionButton>
        ) : null}
      </div>
    </li>
  );
}
