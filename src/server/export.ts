import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExportApplicationData, ExportDeps } from "@/features/export/export-service";
import { loadFormPdfAssets } from "@/features/form-pdf/assets";
import { generateFormPdf, templateForApplication } from "@/features/form-pdf/generate";
import { STORAGE_BUCKET } from "@/lib/domain/constants";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "./auth";
import { fetchApplication, fetchDocumentSlots, fetchExtraDocuments, fetchFormData, fetchReceipts } from "./data/queries";
import { maxExportBytes } from "./limits";
import { logError } from "./log";

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Loads the export data with the CALLER's session (under RLS).
 * No service role is used: even if a non-staff user reached this function,
 * the database would only return the records they can see.
 */
export async function loadExportData(supabase: SupabaseClient, applicationId: string): Promise<ExportApplicationData | null> {
  const application = await fetchApplication(supabase, applicationId);
  if (!application) return null;

  const [formData, slots, receipts, extras, categories] = await Promise.all([
    fetchFormData(supabase, applicationId),
    fetchDocumentSlots(supabase, applicationId),
    fetchReceipts(supabase, applicationId),
    fetchExtraDocuments(supabase, applicationId),
    supabase.from("zip_categories").select("folder_name").eq("is_active", true).order("folder_name"),
  ]);
  if (categories.error) {
    logError("export.load_categories", categories.error);
    throw new Error("ZIP kategorileri okunamadı");
  }

  const personal = formData.personal ?? {};
  const documents = slots
    .filter((slot) => slot.files.length > 0)
    .map((slot) => ({
      label: slot.label,
      folderName: slot.zipFolderName,
      files: slot.files.map((f) => ({ id: f.id, storagePath: f.storagePath, mimeType: f.mimeType, sizeBytes: f.sizeBytes })),
    }));
  if (receipts.length > 0) {
    // No folder mapping is defined for receipts; they stay at the root.
    documents.push({
      label: "Odeme dekontu",
      folderName: null,
      files: receipts.map((f) => ({ id: f.id, storagePath: f.storagePath, mimeType: f.mimeType, sizeBytes: f.sizeBytes })),
    });
  }
  if (extras.length > 0) {
    // Extra documents the customer sent after submission; there is no folder mapping, they stay at the root.
    documents.push({
      label: "Ek evrak",
      folderName: null,
      files: extras.map((f) => ({ id: f.id, storagePath: f.storagePath, mimeType: f.mimeType, sizeBytes: f.sizeBytes })),
    });
  }

  return {
    id: application.id,
    referenceCode: application.referenceCode,
    applicant: { tcNo: str(personal.tcNo), firstName: str(personal.firstName), lastName: str(personal.lastName) },
    formData,
    categoryFolders: (categories.data ?? []).map((c) => str(c.folder_name)),
    documents,
  };
}

/** Generates the application's filled-in form PDF. */
export async function buildFormPdf(application: ExportApplicationData, generatedAt: Date, applicationTypes: readonly string[] = []) {
  const template = templateForApplication(applicationTypes as never[]);
  const assets = await loadFormPdfAssets(template);
  const result = await generateFormPdf({
    template,
    assets,
    formData: application.formData,
    referenceCode: application.referenceCode,
    generatedAt,
  });
  return { fileName: template.outputFileName, bytes: result.bytes, overflowCount: result.overflow.length };
}

export async function createExportDeps(): Promise<ExportDeps> {
  const supabase = await createClient();
  return {
    getActor: async () => {
      const user = await getCurrentUser();
      return user ? { id: user.id, role: user.role, isActive: user.isActive } : null;
    },
    loadApplication: (applicationId) => loadExportData(supabase, applicationId),
    // Files are also downloaded with the staff member's own session (storage RLS: only staff read all files).
    downloadFile: async (storagePath) => {
      const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(storagePath);
      if (error || !data) throw error ?? new Error("Dosya indirilemedi");
      return new Uint8Array(await data.arrayBuffer());
    },
    generateFormPdf: (application, generatedAt) => buildFormPdf(application, generatedAt),
    recordAudit: async (event) => {
      const { error } = await supabase.rpc("record_staff_event", {
        p_action: "export.zip",
        p_application_id: event.applicationId,
        p_details: { outcome: event.outcome, included: event.includedCount, failed: event.failureCount, reason: event.reason ?? null },
      });
      if (error) logError("export.audit", error);
    },
    now: () => new Date(),
    maxTotalBytes: maxExportBytes(),
  };
}
