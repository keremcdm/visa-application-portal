import { ALLOWED_MIME_TYPES, type AllowedMimeType } from "@/lib/domain/constants";

/**
 * Validation of uploaded files.
 *
 * There are two stages:
 *  1. Before upload: the name, type and size the customer reports are checked.
 *  2. After upload: the server looks at the file's REAL content (its first bytes) and size.
 *     The extension or the reported type alone cannot be trusted.
 */

export const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;

const EXTENSIONS: Record<string, AllowedMimeType> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

export const ACCEPT_ATTRIBUTE = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";
export const ALLOWED_FORMATS_TEXT = "PDF, JPG veya PNG";

export function isAllowedMimeType(value: string): value is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(value);
}

export function mimeFromFileName(name: string): AllowedMimeType | null {
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(name.trim());
  if (!match) return null;
  return EXTENSIONS[match[1]!.toLowerCase()] ?? null;
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, i) => bytes[offset + i] === byte);
}

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Determines the real file type from the signature in its content. Returns null if unrecognized. */
export function detectFileType(bytes: Uint8Array): AllowedMimeType | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return "image/png";
  if (startsWith(bytes, JPEG_SIGNATURE)) return "image/jpeg";
  // Per the specification the PDF header may be anywhere in the first 1024 bytes of the file.
  const limit = Math.min(bytes.length - PDF_SIGNATURE.length, 1024);
  for (let offset = 0; offset <= limit; offset++) {
    if (startsWith(bytes, PDF_SIGNATURE, offset)) return "application/pdf";
  }
  return null;
}

export type UploadCheck = { ok: true; mimeType: AllowedMimeType } | { ok: false; message: string };

function formatMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

/** Stage 1: checks the reported information before an upload URL is issued. */
export function checkDeclaredUpload(
  input: { name: string; mimeType: string; sizeBytes: number },
  maxBytes: number = DEFAULT_MAX_FILE_BYTES,
): UploadCheck {
  const byName = mimeFromFileName(input.name);
  if (!byName) {
    return { ok: false, message: `Bu dosya türü desteklenmiyor. Lütfen ${ALLOWED_FORMATS_TEXT} biçiminde bir dosya seçiniz.` };
  }
  // Some browsers report an empty type; if reported, it must match the extension.
  if (input.mimeType !== "" && input.mimeType !== byName) {
    return { ok: false, message: "Dosyanın uzantısı ile türü uyuşmuyor. Lütfen dosyayı kontrol ediniz." };
  }
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, message: "Dosya boş görünüyor. Lütfen başka bir dosya seçiniz." };
  }
  if (input.sizeBytes > maxBytes) {
    return { ok: false, message: `Dosya çok büyük. En fazla ${formatMegabytes(maxBytes)} boyutunda dosya yükleyebilirsiniz.` };
  }
  return { ok: true, mimeType: byName };
}

/** Stage 2: checks the real content of the file that reached storage. */
export function checkUploadedContent(
  bytes: Uint8Array,
  expectedMimeType: AllowedMimeType,
  maxBytes: number = DEFAULT_MAX_FILE_BYTES,
): UploadCheck {
  if (bytes.byteLength === 0) return { ok: false, message: "Yüklenen dosya boş." };
  if (bytes.byteLength > maxBytes) {
    return { ok: false, message: `Dosya çok büyük. En fazla ${formatMegabytes(maxBytes)} boyutunda dosya yükleyebilirsiniz.` };
  }
  const actual = detectFileType(bytes);
  if (!actual) {
    return { ok: false, message: `Dosyanın içeriği tanınamadı. Lütfen geçerli bir ${ALLOWED_FORMATS_TEXT} dosyası yükleyiniz.` };
  }
  if (actual !== expectedMimeType) {
    return { ok: false, message: "Dosyanın içeriği uzantısıyla uyuşmuyor. Lütfen dosyayı kontrol edip yeniden yükleyiniz." };
  }
  return { ok: true, mimeType: actual };
}
