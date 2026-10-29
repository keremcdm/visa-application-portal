import type { NextRequest } from "next/server";
import { buildFormPdfFileName, contentDispositionAttachment } from "@/features/export/filenames";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isActiveStaff } from "@/server/auth";
import { buildFormPdf, loadExportData } from "@/server/export";
import { navigationError } from "@/server/http";
import { logError } from "@/server/log";
import { FORBIDDEN_ERROR, isUuid, NOT_CONFIGURED_ERROR, NOT_FOUND_ERROR, SESSION_EXPIRED_ERROR } from "@/server/result";

/** Generates the application form PDF filled in from the customer's answers (staff only). */
export async function GET(request: NextRequest, context: RouteContext<"/api/admin/applications/[id]/form-pdf">) {
  if (!isSupabaseConfigured()) return navigationError(request, 503, NOT_CONFIGURED_ERROR, "temporary");
  const user = await getCurrentUser();
  if (!user) return navigationError(request, 401, SESSION_EXPIRED_ERROR, "forbidden");
  if (!isActiveStaff(user)) return navigationError(request, 403, FORBIDDEN_ERROR, "forbidden");

  const { id } = await context.params;
  if (!isUuid(id)) return navigationError(request, 404, NOT_FOUND_ERROR, "record");

  try {
    const supabase = await createClient();
    const application = await loadExportData(supabase, id);
    if (!application) return navigationError(request, 404, NOT_FOUND_ERROR, "record");

    const pdf = await buildFormPdf(application, new Date());
    const { error } = await supabase.rpc("record_staff_event", {
      p_action: "form_pdf.downloaded",
      p_application_id: id,
      p_details: { overflow: pdf.overflowCount },
    });
    if (error) logError("form_pdf.audit", error);

    // File name: "Name Surname - Application number.pdf"; the ID number is never written into the file name.
    const fileName = buildFormPdfFileName({
      firstName: application.applicant.firstName,
      lastName: application.applicant.lastName,
      referenceCode: application.referenceCode,
    });
    return new Response(pdf.bytes as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.bytes.byteLength),
        "Content-Disposition": contentDispositionAttachment(fileName),
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    logError("form_pdf.generate", error);
    return navigationError(request, 500, "Başvuru formu oluşturulamadı. Lütfen tekrar deneyiniz.", "temporary");
  }
}
