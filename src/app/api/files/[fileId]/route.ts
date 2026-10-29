import { NextResponse, type NextRequest } from "next/server";
import { extensionForMime, slugForFileName } from "@/features/export/filenames";
import { STORAGE_BUCKET } from "@/lib/domain/constants";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isActiveStaff } from "@/server/auth";
import { navigationError } from "@/server/http";
import { logError } from "@/server/log";
import { isUuid, NOT_CONFIGURED_ERROR, NOT_FOUND_ERROR, SESSION_EXPIRED_ERROR } from "@/server/result";

const SIGNED_URL_TTL_SECONDS = 60;

/**
 * Views or downloads a single file.
 *
 * Files are NEVER at a public address. This route:
 *  1. verifies the session,
 *  2. reads the file record with the user's own session (RLS: only the applicant or staff can see it),
 *  3. again with the user's session, creates a signed URL valid for 60 seconds (storage RLS checks a second time)
 *     and redirects the browser there.
 * A user without access cannot find out whether the file exists (404 in every case).
 * If the link was opened in the browser, errors come back as a redirect to an error page instead of JSON (navigationError).
 */
export async function GET(request: NextRequest, context: RouteContext<"/api/files/[fileId]">) {
  if (!isSupabaseConfigured()) return navigationError(request, 503, NOT_CONFIGURED_ERROR, "temporary");
  const user = await getCurrentUser();
  if (!user) return navigationError(request, 401, SESSION_EXPIRED_ERROR, "file");

  const { fileId } = await context.params;
  if (!isUuid(fileId)) return navigationError(request, 404, NOT_FOUND_ERROR, "file");

  const supabase = await createClient();
  const { data: file, error } = await supabase
    .from("application_files")
    .select("id, application_id, storage_path, mime_type, kind, status")
    .eq("id", fileId)
    .eq("status", "ready")
    .maybeSingle();
  if (error) {
    logError("file.download.read", error);
    return navigationError(request, 500, "Dosya açılamadı. Lütfen tekrar deneyiniz.", "temporary");
  }
  if (!file) return navigationError(request, 404, NOT_FOUND_ERROR, "file");

  const download = request.nextUrl.searchParams.get("download") === "1";
  const extension = extensionForMime(String(file.mime_type)) ?? "bin";
  // The download name is a safe name generated from the type, not the file name the customer provided.
  const BASE_NAMES: Record<string, string> = {
    payment_receipt: "Dekont",
    staff_attachment: "Belge",
    visa_result: "Vize sonucu",
    appointment_letter: "Randevu belgesi",
    extra_document: "Ek evrak",
  };
  const baseName = BASE_NAMES[String(file.kind)] ?? "Evrak";
  const fileName = `${slugForFileName(baseName)}.${extension}`;

  const { data: signed, error: signError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(String(file.storage_path), SIGNED_URL_TTL_SECONDS, download ? { download: fileName } : undefined);
  if (signError || !signed?.signedUrl) {
    if (signError) logError("file.download.sign", signError);
    return navigationError(request, 404, NOT_FOUND_ERROR, "file");
  }

  if (isActiveStaff(user)) {
    const { error: auditError } = await supabase.rpc("record_staff_event", {
      p_action: "file.viewed",
      p_application_id: file.application_id,
      p_details: { file_id: file.id, kind: file.kind },
    });
    if (auditError) logError("file.download.audit", auditError);
  }

  const response = NextResponse.redirect(signed.signedUrl, 303);
  response.headers.set("Cache-Control", "no-store, private");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
