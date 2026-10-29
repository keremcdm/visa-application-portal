import { checkDeclaredUpload } from "@/features/documents/file-validation";
import { getBrowserClient } from "@/lib/supabase/browser";
import { finalizeUploadAction, requestUploadAction, type UploadTarget } from "@/server/actions/documents";

export type UploadOutcome = { ok: true; fileId: string } | { ok: false; message: string };

/**
 * Uploads a single file from the browser. Flow: get permission and a signed URL from the server -> upload the file directly
 * to storage -> have the server verify the content. A file only counts as "uploaded" after the server has verified its content.
 */
export async function uploadApplicationFile(applicationId: string, target: UploadTarget, file: File, maxBytes: number): Promise<UploadOutcome> {
  const precheck = checkDeclaredUpload({ name: file.name, mimeType: file.type, sizeBytes: file.size }, maxBytes);
  if (!precheck.ok) return { ok: false, message: precheck.message };
  try {
    const ticket = await requestUploadAction(applicationId, target, { name: file.name, type: file.type, size: file.size });
    if (!ticket.ok || !ticket.data) return { ok: false, message: ticket.ok ? "Yükleme başlatılamadı." : ticket.message };
    const supabase = getBrowserClient();
    if (!supabase) return { ok: false, message: "Sistem bağlantısı yapılandırılmadığı için dosya yüklenemiyor." };
    const { error } = await supabase.storage
      .from(ticket.data.bucket)
      .uploadToSignedUrl(ticket.data.path, ticket.data.token, file, { contentType: ticket.data.mimeType });
    if (error) return { ok: false, message: "Dosya yüklenemedi. İnternet bağlantınızı kontrol edip tekrar deneyiniz." };
    const result = await finalizeUploadAction(applicationId, ticket.data.fileId, target);
    if (!result.ok) return { ok: false, message: result.message };
    return { ok: true, fileId: ticket.data.fileId };
  } catch {
    return { ok: false, message: "Dosya yüklenemedi. Lütfen tekrar deneyiniz." };
  }
}
