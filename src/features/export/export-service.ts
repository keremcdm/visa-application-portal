import type { FormData } from "@/features/application-form/types";
import { buildZip, MISSING_REPORT_FILE_NAME, type ZipFailure } from "./build-zip";
import { buildZipFileName } from "./filenames";
import { buildZipPlan, type ExportDocument } from "./plan";

/**
 * Core of the "Tüm evrakları indir" (download all documents) operation.
 *
 * Data access and storage dependencies are injected (see src/server/export.ts);
 * so authorization and error behaviour can be tested without Supabase.
 */

export type ExportActor = { id: string; role: "customer" | "staff"; isActive: boolean };

export type ExportApplicationData = {
  id: string;
  referenceCode: string;
  applicant: { tcNo: string; firstName: string; lastName: string };
  formData: FormData;
  /** Active ZIP category folders, in order. */
  categoryFolders: string[];
  documents: ExportDocument[];
};

export type ExportAuditEvent = {
  actorId: string;
  applicationId: string;
  outcome: "ok" | "partial" | "failed";
  includedCount: number;
  failureCount: number;
  reason?: string;
};

export type ExportDeps = {
  getActor: () => Promise<ExportActor | null>;
  /** Loads the application with the caller's session (under RLS); returns null if there is no access. */
  loadApplication: (applicationId: string) => Promise<ExportApplicationData | null>;
  downloadFile: (storagePath: string) => Promise<Uint8Array>;
  generateFormPdf: (application: ExportApplicationData, generatedAt: Date) => Promise<{ fileName: string; bytes: Uint8Array }>;
  recordAudit: (event: ExportAuditEvent) => Promise<void>;
  now: () => Date;
  maxTotalBytes: number;
};

export type ExportOutcome =
  | { status: "unauthenticated" | "forbidden" | "not_found" | "invalid_request" }
  | { status: "failed"; reason: "missing_files" | "too_large"; failures: ZipFailure[] }
  | { status: "ok" | "partial"; fileName: string; bytes: Uint8Array; includedCount: number; failures: ZipFailure[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The storage path can only have the form the server generates: "<application-uuid>/<file-uuid>.<extension>". */
export function isValidStoragePath(storagePath: string, applicationId: string): boolean {
  const match = /^([0-9a-f-]{36})\/([0-9a-f-]{36})\.(pdf|jpg|png)$/i.exec(storagePath);
  return match !== null && match[1]!.toLowerCase() === applicationId.toLowerCase() && UUID.test(match[2]!);
}

export const FORM_PDF_ROOT_NAME = "Doldurulmus_Basvuru_Formu.pdf";

export async function exportApplicationZip(
  deps: ExportDeps,
  applicationId: string,
  options: { allowPartial: boolean },
): Promise<ExportOutcome> {
  if (!UUID.test(applicationId)) return { status: "invalid_request" };

  const actor = await deps.getActor();
  if (!actor) return { status: "unauthenticated" };
  if (actor.role !== "staff" || !actor.isActive) return { status: "forbidden" };

  const application = await deps.loadApplication(applicationId);
  if (!application) return { status: "not_found" };

  const generatedAt = deps.now();
  const plan = buildZipPlan({
    categoryFolders: application.categoryFolders,
    documents: application.documents,
    reservedRootNames: [FORM_PDF_ROOT_NAME, MISSING_REPORT_FILE_NAME],
  });

  const result = await buildZip({
    plan,
    fetchFile: async (entry) => {
      if (!isValidStoragePath(entry.storagePath, application.id)) {
        throw new Error("Geçersiz depolama yolu");
      }
      return deps.downloadFile(entry.storagePath);
    },
    formPdf: {
      fileName: FORM_PDF_ROOT_NAME,
      generate: async () => (await deps.generateFormPdf(application, generatedAt)).bytes,
    },
    allowPartial: options.allowPartial,
    maxTotalBytes: deps.maxTotalBytes,
    generatedAt,
  });

  if (result.status === "failed") {
    await deps.recordAudit({
      actorId: actor.id,
      applicationId: application.id,
      outcome: "failed",
      includedCount: 0,
      failureCount: result.failures.length,
      reason: result.reason,
    });
    return { status: "failed", reason: result.reason, failures: result.failures };
  }

  await deps.recordAudit({
    actorId: actor.id,
    applicationId: application.id,
    outcome: result.status,
    includedCount: result.includedPaths.length,
    failureCount: result.failures.length,
  });

  return {
    status: result.status,
    fileName: buildZipFileName({
      tcNo: application.applicant.tcNo,
      firstName: application.applicant.firstName,
      lastName: application.applicant.lastName,
      fallbackId: application.referenceCode,
    }),
    bytes: result.bytes,
    includedCount: result.includedPaths.length,
    failures: result.failures,
  };
}
