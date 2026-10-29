import type { NextRequest } from "next/server";
import { exportApplicationZip } from "@/features/export/export-service";
import { contentDispositionAttachment } from "@/features/export/filenames";
import { bytesToStream } from "@/features/export/stream";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createExportDeps } from "@/server/export";
import { isSameOrigin, jsonError } from "@/server/http";
import { logError } from "@/server/log";
import { FORBIDDEN_ERROR, NOT_CONFIGURED_ERROR, NOT_FOUND_ERROR, SESSION_EXPIRED_ERROR } from "@/server/result";

/**
 * "Tüm evrakları indir" (download all documents): returns all documents of the application as one ZIP.
 *
 *  - Only active staff can call it (the role is checked on the server and in the database).
 *  - The national ID number appears only in the downloaded file name (Content-Disposition);
 *    never in the URL, logs or error messages.
 *  - If files are missing no ZIP is sent; the missing items are returned as JSON. If staff explicitly confirm
 *    (?partial=1) a partial ZIP with a missing-files report is sent.
 *  - The ZIP is streamed: on Vercel a single-part response can be at most 4.5 MB. The size is announced in X-Export-Size;
 *    the browser does not save an incomplete download (src/features/export/stream.ts).
 */
export async function POST(request: NextRequest, context: RouteContext<"/api/admin/applications/[id]/export">) {
  if (!isSupabaseConfigured()) return jsonError(503, NOT_CONFIGURED_ERROR);
  if (!isSameOrigin(request)) return jsonError(403, FORBIDDEN_ERROR);

  const { id } = await context.params;
  const allowPartial = request.nextUrl.searchParams.get("partial") === "1";

  try {
    const outcome = await exportApplicationZip(await createExportDeps(), id, { allowPartial });
    switch (outcome.status) {
      case "unauthenticated":
        return jsonError(401, SESSION_EXPIRED_ERROR);
      case "forbidden":
        return jsonError(403, FORBIDDEN_ERROR);
      case "invalid_request":
      case "not_found":
        return jsonError(404, NOT_FOUND_ERROR);
      case "failed":
        return jsonError(
          409,
          outcome.reason === "too_large"
            ? "Başvurunun dosyaları tek seferde indirilemeyecek kadar büyük. Lütfen dosyaları tek tek indiriniz veya sistem yöneticinize başvurunuz."
            : "Bazı dosyalar arşive eklenemedi. ZIP oluşturulmadı.",
          { reason: outcome.reason, failures: outcome.failures },
        );
      default:
        return new Response(bytesToStream(outcome.bytes), {
          status: 200,
          headers: {
            "Content-Type": "application/zip",
            "X-Export-Size": String(outcome.bytes.byteLength),
            "Content-Disposition": contentDispositionAttachment(outcome.fileName),
            "Cache-Control": "no-store, private",
            "X-Content-Type-Options": "nosniff",
            "X-Export-Status": outcome.status,
            "X-Export-Included": String(outcome.includedCount),
            "X-Export-Missing": String(outcome.failures.length),
          },
        });
    }
  } catch (error) {
    logError("export.zip", error);
    return jsonError(500, "ZIP dosyası oluşturulamadı. Lütfen tekrar deneyiniz.");
  }
}
