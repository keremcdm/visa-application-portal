import type { NextRequest } from "next/server";
import { loadChecklistPdfAssets } from "@/features/documents/checklist-assets";
import { buildChecklistPdf, checklistItems } from "@/features/documents/checklist-pdf";
import { buildChecklistPdfFileName, contentDispositionInline } from "@/features/export/filenames";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isActiveStaff } from "@/server/auth";
import { fetchApplication, fetchDocumentSlots } from "@/server/data/queries";
import { navigationError } from "@/server/http";
import { logError } from "@/server/log";
import { FORBIDDEN_ERROR, isUuid, NOT_CONFIGURED_ERROR, NOT_FOUND_ERROR, SESSION_EXPIRED_ERROR } from "@/server/result";

/**
 * List of the documents required for the application: logo at the top, then only the list.
 * Can be opened by the applicant and staff; opens in the browser and can be saved from there.
 */
export async function GET(request: NextRequest, context: RouteContext<"/api/applications/[id]/document-checklist">) {
  if (!isSupabaseConfigured()) return navigationError(request, 503, NOT_CONFIGURED_ERROR, "temporary");
  const user = await getCurrentUser();
  if (!user) return navigationError(request, 401, SESSION_EXPIRED_ERROR, "record");

  const { id } = await context.params;
  if (!isUuid(id)) return navigationError(request, 404, NOT_FOUND_ERROR, "record");

  try {
    const supabase = await createClient();
    // RLS: the application is only visible to its owner and staff; identity is still checked explicitly here.
    const application = await fetchApplication(supabase, id);
    if (!application) return navigationError(request, 404, NOT_FOUND_ERROR, "record");
    if (application.customerId !== user.id && !isActiveStaff(user)) return navigationError(request, 403, FORBIDDEN_ERROR, "record");

    const items = checklistItems(await fetchDocumentSlots(supabase, id));
    const bytes = await buildChecklistPdf(items, await loadChecklistPdfAssets());
    return new Response(bytes as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": contentDispositionInline(buildChecklistPdfFileName(application.referenceCode)),
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    logError("checklist_pdf.generate", error);
    return navigationError(request, 500, "Evrak listesi oluşturulamadı. Lütfen tekrar deneyiniz.", "temporary");
  }
}
