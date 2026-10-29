"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extensionForMime, sanitizeDisplayFileName } from "@/features/export/filenames";
import { checkDeclaredUpload, checkUploadedContent, isAllowedMimeType } from "@/features/documents/file-validation";
import { canCustomerDeleteFile, type DocumentSlotState } from "@/features/documents/rules";
import { extraDocumentLimitFrom } from "@/features/documents/extra-documents";
import { decideUpload } from "@/features/documents/upload-authorization";
import { STORAGE_BUCKET, type FileKind } from "@/lib/domain/constants";
import { customerApplicationPath, staffApplicationPath } from "@/lib/site";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isActiveStaff, type CurrentUser } from "../auth";
import { fetchApplication, fetchDocumentSlots, fetchExtraDocuments, fetchReceipts, fetchSettings, paymentInfoFrom } from "../data/queries";
import type { Application, DocumentSlot } from "../data/types";
import { logError, logWarning } from "../log";
import { fail, FORBIDDEN_ERROR, GENERIC_ERROR, isUuid, NOT_CONFIGURED_ERROR, NOT_FOUND_ERROR, ok, SESSION_EXPIRED_ERROR, type ActionResult } from "../result";
import { maxUploadBytes } from "../limits";

/**
 * FILE UPLOAD / DELETE
 *
 * Upload takes three steps:
 *  1. requestUploadAction : permission + check of the reported name/type/size -> "pending" record + single-use signed upload URL
 *  2. The browser uploads the file directly to the signed URL (the file never passes through the app server).
 *  3. finalizeUploadAction: the server reads the file from storage and verifies its REAL content (signature bytes) and size;
 *     if valid the record becomes "ready", otherwise the file and the record are deleted.
 * Files that are not "ready" never appear in any list, download or ZIP.
 * Customers have no direct write access to storage (see migration: storage policies).
 */

const PENDING_TTL_MS = 2 * 60 * 60 * 1000;

export type UploadTarget =
  | { kind: "document"; documentId: string }
  | { kind: "payment_receipt" }
  | { kind: "staff_attachment"; documentId: string }
  /** Screenshot of the visa outcome. The uploaded file is attached to the application when the outcome is recorded (setVisaOutcomeAction). */
  | { kind: "visa_result" }
  /** Appointment letter. Uploading a new one deletes the old one. */
  | { kind: "appointment_letter" }
  /** Extra document sent by the customer after submission. */
  | { kind: "extra_document" };

export type UploadTicket = { fileId: string; bucket: string; path: string; token: string; mimeType: string };

function isUploadTarget(value: unknown): value is UploadTarget {
  if (typeof value !== "object" || value === null) return false;
  const target = value as { kind?: unknown; documentId?: unknown };
  if (target.kind === "payment_receipt" || target.kind === "visa_result" || target.kind === "appointment_letter" || target.kind === "extra_document") {
    return true;
  }
  return (target.kind === "document" || target.kind === "staff_attachment") && isUuid(target.documentId);
}

type Context = { user: CurrentUser; supabase: SupabaseClient; staff: boolean };

async function getContext(): Promise<Context | { error: string }> {
  if (!isSupabaseConfigured() || !isAdminClientConfigured()) return { error: NOT_CONFIGURED_ERROR };
  const user = await getCurrentUser();
  if (!user) return { error: SESSION_EXPIRED_ERROR };
  return { user, supabase: await createClient(), staff: isActiveStaff(user) };
}

function slotState(slot: DocumentSlot): DocumentSlotState {
  return {
    requirement: slot.requirement,
    outOfScope: slot.outOfScope,
    reuploadAllowed: slot.reuploadAllowed,
    reviewStatus: slot.reviewStatus,
    maxFiles: slot.maxFiles,
    fileCount: slot.files.length,
  };
}

/** Permission and business rule check for the upload target. Runs both when issuing the URL and when confirming the file. */
async function authorizeUpload(
  ctx: Context,
  application: Application,
  target: UploadTarget,
): Promise<{ ok: true; documentId: string | null } | { ok: false; message: string }> {
  const actor = { id: ctx.user.id, isStaff: ctx.staff };

  if (target.kind === "visa_result" || target.kind === "appointment_letter") {
    const decision = decideUpload(actor, application, { kind: target.kind });
    return decision.ok ? { ok: true, documentId: null } : { ok: false, message: decision.message };
  }

  if (target.kind === "extra_document") {
    const [settings, extras] = await Promise.all([fetchSettings(ctx.supabase), fetchExtraDocuments(ctx.supabase, application.id)]);
    const decision = decideUpload(actor, application, {
      kind: "extra_document",
      uploadedCount: extras.length,
      limit: extraDocumentLimitFrom(settings),
    });
    return decision.ok ? { ok: true, documentId: null } : { ok: false, message: decision.message };
  }

  if (target.kind === "payment_receipt") {
    const payment = paymentInfoFrom(await fetchSettings(ctx.supabase));
    const receipts = await fetchReceipts(ctx.supabase, application.id);
    const decision = decideUpload(actor, application, {
      kind: "payment_receipt",
      receiptUploadEnabled: payment.receiptUploadEnabled,
      existingReceiptCount: receipts.length,
    });
    return decision.ok ? { ok: true, documentId: null } : { ok: false, message: decision.message };
  }

  // RLS: document slots are only visible to the applicant or staff.
  const slot = isUuid(target.documentId)
    ? ((await fetchDocumentSlots(ctx.supabase, application.id)).find((s) => s.id === target.documentId) ?? null)
    : null;
  const decision = decideUpload(actor, application, { kind: target.kind, slot: slot ? slotState(slot) : null });
  return decision.ok && slot ? { ok: true, documentId: slot.id } : { ok: false, message: decision.ok ? NOT_FOUND_ERROR : decision.message };
}

async function removeObject(admin: SupabaseClient, path: string): Promise<void> {
  const { error } = await admin.storage.from(STORAGE_BUCKET).remove([path]);
  if (error) logError("storage.remove", error);
}

/** Cleans up old, unfinished (unconfirmed) uploads. */
async function cleanupStalePending(admin: SupabaseClient, applicationId: string): Promise<void> {
  const cutoff = new Date(Date.now() - PENDING_TTL_MS).toISOString();
  const { data, error } = await admin
    .from("application_files")
    .select("id, storage_path")
    .eq("application_id", applicationId)
    .eq("status", "pending")
    .lt("created_at", cutoff);
  if (error || !data || data.length === 0) return;
  await admin.storage.from(STORAGE_BUCKET).remove(data.map((f) => f.storage_path as string));
  await admin.from("application_files").delete().in("id", data.map((f) => f.id as string));
}

/** A clear message if the database's extra document rule (migration 26) refuses after the app's check (e.g. two uploads at the same time). */
function databaseRuleMessage(error: { message?: string }): string | null {
  if (error.message?.includes("extra_document_limit")) return "Ek evrak sınırına ulaşıldı; bu dosya gönderilmedi.";
  if (error.message?.includes("extra_document_not_allowed")) return "Bu başvuruya şu anda ek evrak gönderilemez.";
  return null;
}

function revalidateApplication(applicationId: string): void {
  revalidatePath(customerApplicationPath(applicationId), "layout");
  revalidatePath(staffApplicationPath(applicationId));
}

export async function requestUploadAction(
  applicationId: string,
  target: UploadTarget,
  file: { name: string; type: string; size: number },
): Promise<ActionResult<UploadTicket>> {
  const ctx = await getContext();
  if ("error" in ctx) return fail(ctx.error);
  if (!isUuid(applicationId) || !isUploadTarget(target)) return fail(NOT_FOUND_ERROR);

  // Server action arguments come from the client and are untrusted; types are pinned here.
  const fileName = typeof file?.name === "string" ? file.name : "";
  const fileSize = typeof file?.size === "number" ? file.size : Number.NaN;
  const declared = checkDeclaredUpload(
    { name: fileName, mimeType: typeof file?.type === "string" ? file.type : "", sizeBytes: fileSize },
    maxUploadBytes(),
  );
  if (!declared.ok) return fail(declared.message);

  // RLS: the application is only visible to its owner or staff.
  const application = await fetchApplication(ctx.supabase, applicationId);
  if (!application) return fail(NOT_FOUND_ERROR);
  const authorization = await authorizeUpload(ctx, application, target);
  if (!authorization.ok) return fail(authorization.message);

  const admin = createAdminClient();
  await cleanupStalePending(admin, applicationId);

  const fileId = randomUUID();
  const path = `${applicationId}/${fileId}.${extensionForMime(declared.mimeType)}`;
  const kind: FileKind = target.kind;

  const { error: insertError } = await admin.from("application_files").insert({
    id: fileId,
    application_id: applicationId,
    application_document_id: kind === "document" ? authorization.documentId : null,
    kind,
    storage_path: path,
    original_name: sanitizeDisplayFileName(fileName),
    mime_type: declared.mimeType,
    size_bytes: fileSize,
    status: "pending",
    uploaded_by: ctx.user.id,
  });
  if (insertError) {
    logError("upload.register", insertError);
    return fail(databaseRuleMessage(insertError) ?? GENERIC_ERROR);
  }

  const { data: signed, error: signError } = await admin.storage.from(STORAGE_BUCKET).createSignedUploadUrl(path);
  if (signError || !signed) {
    if (signError) logError("upload.sign", signError);
    await admin.from("application_files").delete().eq("id", fileId);
    return fail("Yükleme başlatılamadı. Lütfen tekrar deneyiniz.");
  }

  return ok(undefined, { fileId, bucket: STORAGE_BUCKET, path: signed.path, token: signed.token, mimeType: declared.mimeType });
}

export async function finalizeUploadAction(applicationId: string, fileId: string, target: UploadTarget): Promise<ActionResult> {
  const ctx = await getContext();
  if ("error" in ctx) return fail(ctx.error);
  if (!isUuid(applicationId) || !isUuid(fileId) || !isUploadTarget(target)) return fail(NOT_FOUND_ERROR);

  const admin = createAdminClient();
  const { data: row, error: rowError } = await admin
    .from("application_files")
    .select("id, application_id, application_document_id, kind, storage_path, mime_type, status, uploaded_by")
    .eq("id", fileId)
    .maybeSingle();
  if (rowError) {
    logError("upload.finalize.read", rowError);
    return fail(GENERIC_ERROR);
  }
  // Only the user who started the upload can confirm their own pending record.
  if (!row || row.application_id !== applicationId || row.uploaded_by !== ctx.user.id || row.status !== "pending" || row.kind !== target.kind) {
    return fail(NOT_FOUND_ERROR);
  }
  const path = row.storage_path as string;
  const mimeType = String(row.mime_type);

  const discard = async (message: string): Promise<ActionResult> => {
    await removeObject(admin, path);
    await admin.from("application_files").delete().eq("id", fileId);
    return fail(message);
  };

  // Permissions and rules are checked again since they may have changed during the upload.
  const application = await fetchApplication(ctx.supabase, applicationId);
  if (!application) return discard(NOT_FOUND_ERROR);
  const authorization = await authorizeUpload(ctx, application, target);
  if (!authorization.ok) return discard(authorization.message);
  if (target.kind === "document" && authorization.documentId !== row.application_document_id) return discard(NOT_FOUND_ERROR);

  const { data: blob, error: downloadError } = await admin.storage.from(STORAGE_BUCKET).download(path);
  if (downloadError || !blob) {
    if (downloadError) logError("upload.finalize.download", downloadError);
    await admin.from("application_files").delete().eq("id", fileId);
    return fail("Dosya yüklenemedi. Lütfen tekrar deneyiniz.");
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!isAllowedMimeType(mimeType)) return discard(GENERIC_ERROR);
  const content = checkUploadedContent(bytes, mimeType, maxUploadBytes());
  if (!content.ok) return discard(content.message);

  const { error: readyError } = await admin
    .from("application_files")
    .update({ status: "ready", size_bytes: bytes.byteLength })
    .eq("id", fileId)
    .eq("status", "pending");
  if (readyError) {
    logError("upload.finalize.ready", readyError);
    return discard(databaseRuleMessage(readyError) ?? GENERIC_ERROR);
  }

  if (target.kind === "staff_attachment") {
    const { data: previous } = await ctx.supabase
      .from("application_documents")
      .select("attachment_file_id")
      .eq("id", target.documentId)
      .eq("application_id", applicationId)
      .maybeSingle();
    // Attached to the document slot with the staff member's own session (RLS: staff only).
    const { error: attachError } = await ctx.supabase
      .from("application_documents")
      .update({ attachment_file_id: fileId })
      .eq("id", target.documentId)
      .eq("application_id", applicationId);
    if (attachError) {
      logError("upload.finalize.attach", attachError);
      return discard("Dosya belge isteğine bağlanamadı. Lütfen tekrar deneyiniz.");
    }
    // The replaced old document is no longer attached anywhere; its record and file are deleted.
    const previousId = previous?.attachment_file_id;
    if (typeof previousId === "string" && previousId !== fileId) {
      const { data: oldPath, error: oldError } = await admin.rpc("svc_delete_file", { p_actor_id: ctx.user.id, p_file_id: previousId });
      if (oldError) logError("upload.finalize.replace_attachment", oldError);
      else if (typeof oldPath === "string") await removeObject(admin, oldPath);
    }
  }

  if (target.kind === "appointment_letter") {
    // The application has a single appointment letter: uploading a new one deletes the old ones (record and file).
    const { data: older, error: olderError } = await admin
      .from("application_files")
      .select("id")
      .eq("application_id", applicationId)
      .eq("kind", "appointment_letter")
      .eq("status", "ready")
      .neq("id", fileId);
    if (olderError) logError("upload.finalize.appointment_letter", olderError);
    for (const old of older ?? []) {
      const { data: oldPath, error: oldError } = await admin.rpc("svc_delete_file", { p_actor_id: ctx.user.id, p_file_id: old.id });
      if (oldError) logError("upload.finalize.replace_appointment_letter", oldError);
      else if (typeof oldPath === "string") await removeObject(admin, oldPath);
    }
  }

  revalidateApplication(applicationId);
  return ok("Dosya yüklendi.");
}

export async function deleteFileAction(applicationId: string, fileId: string): Promise<ActionResult> {
  const ctx = await getContext();
  if ("error" in ctx) return fail(ctx.error);
  if (!isUuid(applicationId) || !isUuid(fileId)) return fail(NOT_FOUND_ERROR);

  const application = await fetchApplication(ctx.supabase, applicationId);
  if (!application) return fail(NOT_FOUND_ERROR);

  // RLS: the file record is only visible to the applicant or staff.
  const { data: row, error } = await ctx.supabase
    .from("application_files")
    .select("id, application_id, application_document_id, kind, status")
    .eq("id", fileId)
    .eq("application_id", applicationId)
    .maybeSingle();
  if (error) {
    logError("file.delete.read", error);
    return fail(GENERIC_ERROR);
  }
  if (!row) return fail(NOT_FOUND_ERROR);

  if (!ctx.staff) {
    if (application.customerId !== ctx.user.id) return fail(FORBIDDEN_ERROR);
    // The customer cannot delete the document staff sent them, the visa outcome or the appointment letter. Nor can they delete
    // an extra document they sent.
    if (row.kind === "staff_attachment" || row.kind === "visa_result" || row.kind === "appointment_letter" || row.kind === "extra_document") {
      return fail(FORBIDDEN_ERROR);
    }
    if (row.kind === "payment_receipt") {
      if (application.paymentStatus === "verified") return fail("Ödemeniz doğrulandığı için dekont silinemez.");
    } else {
      const slot = (await fetchDocumentSlots(ctx.supabase, applicationId)).find((s) => s.id === row.application_document_id);
      if (!slot) return fail(NOT_FOUND_ERROR);
      const rule = canCustomerDeleteFile(application.status, slotState(slot));
      if (!rule.ok) return fail(rule.message);
    }
  }

  const admin = createAdminClient();
  const { data: path, error: deleteError } = await admin.rpc("svc_delete_file", { p_actor_id: ctx.user.id, p_file_id: fileId });
  if (deleteError) {
    logError("file.delete", deleteError);
    return fail(GENERIC_ERROR);
  }
  if (typeof path === "string") {
    const { error: removeError } = await admin.storage.from(STORAGE_BUCKET).remove([path]);
    // The record was deleted; if the object could not be deleted it is no longer reachable from anywhere but takes up space in storage.
    if (removeError) logWarning("file.delete.orphan_object", { fileId });
  }

  revalidateApplication(applicationId);
  return ok("Dosya silindi.");
}
