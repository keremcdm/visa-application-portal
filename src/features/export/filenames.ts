/**
 * Safe file name generation for the ZIP export and downloads.
 * These functions are pure; no text from the user is ever used directly as a file path.
 */

const TURKISH_MAP: Record<string, string> = {
  ç: "c",
  Ç: "C",
  ğ: "g",
  Ğ: "G",
  ı: "i",
  I: "I",
  İ: "I",
  ö: "o",
  Ö: "O",
  ş: "s",
  Ş: "S",
  ü: "u",
  Ü: "U",
  â: "a",
  Â: "A",
  î: "i",
  Î: "I",
  û: "u",
  Û: "U",
};

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** Converts Turkish and accented letters to their ASCII equivalents. */
export function transliterate(text: string): string {
  const mapped = Array.from(text, (ch) => TURKISH_MAP[ch] ?? ch).join("");
  return mapped.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/**
 * Makes a single file/folder name segment safe:
 * path separators, control characters and characters forbidden by operating systems are removed.
 * The result consists only of [A-Za-z0-9 ._()-]; returns "" if nothing is left.
 */
export function sanitizeNamePart(text: string, maxLength = 80): string {
  const ascii = transliterate(text)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[^A-Za-z0-9 ._()-]/g, " ")
    // Runs of dots (including "..") collapse to one dot; lone dots are dropped.
    .replace(/\.{2,}/g, ".")
    .replace(/(^|\s)\.(?=\s|$)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
    // Leading/trailing dots and spaces cause problems on Windows; names like ".." are eliminated this way too.
    .replace(/^[. ]+|[. ]+$/g, "");
  if (ascii === "") return "";
  return WINDOWS_RESERVED.test(ascii) ? `_${ascii}` : ascii;
}

/** "Geçerli pasaport" -> "Gecerli_pasaport" */
export function slugForFileName(text: string, maxLength = 60): string {
  return sanitizeNamePart(text, maxLength).replace(/ /g, "_");
}

/**
 * Validates a ZIP folder name defined by the company. The spelling (e.g. "accomodation", "pasaport")
 * is deliberately kept; only names that are dangerous from a security standpoint are rejected.
 */
export function isSafeFolderName(name: string): boolean {
  if (name.length === 0 || name.length > 60) return false;
  if (name !== name.trim()) return false;
  if (name === "." || name === "..") return false;
  if (/[\\/:*?"<>|\u0000-\u001f\u007f]/.test(name)) return false;
  if (name.endsWith(".")) return false;
  return !WINDOWS_RESERVED.test(name);
}

export type ZipNameInput = {
  tcNo: string | null | undefined;
  firstName: string | null | undefined;
  lastName: string | null | undefined;
  /** Identifier to use if there is no national ID number (the application number). */
  fallbackId: string;
};

/**
 * Name of the downloaded ZIP: "NameSurname - NationalIdNo.zip". If the ID number is not 11 digits the application number is
 * used, and "Isimsiz" (unnamed) if the name is empty; the name is never empty.
 */
export function buildZipFileName(input: ZipNameInput): string {
  const tc = (input.tcNo ?? "").trim();
  const id = /^[0-9]{11}$/.test(tc) ? tc : sanitizeNamePart(input.fallbackId, 40) || "Basvuru";
  const name = sanitizeNamePart(`${input.firstName ?? ""} ${input.lastName ?? ""}`, 80) || "Isimsiz";
  return `${name} - ${id}.zip`;
}

/**
 * Name of the downloaded form PDF: "NameSurname - ApplicationNo.pdf". The ID number is never written into the file name; "Isimsiz" if the name is empty.
 */
export function buildFormPdfFileName(input: { firstName: string | null | undefined; lastName: string | null | undefined; referenceCode: string }): string {
  const name = sanitizeNamePart(`${input.firstName ?? ""} ${input.lastName ?? ""}`, 80) || "Isimsiz";
  const reference = sanitizeNamePart(input.referenceCode, 40) || "Basvuru";
  return `${name} - ${reference}.pdf`;
}

/** Content-Disposition header with a safe (ASCII) file name (download). */
export function contentDispositionAttachment(fileName: string): string {
  return contentDisposition("attachment", fileName);
}

/** Content-Disposition for a file opened in the browser (e.g. in the PDF viewer); it gets this name if saved. */
export function contentDispositionInline(fileName: string): string {
  return contentDisposition("inline", fileName);
}

function contentDisposition(type: "attachment" | "inline", fileName: string): string {
  const safe = sanitizeNamePart(fileName.replace(/\.[A-Za-z0-9]+$/, ""), 120) || "dosya";
  const extension = /\.([A-Za-z0-9]{1,5})$/.exec(fileName)?.[1]?.toLowerCase();
  const full = extension ? `${safe}.${extension}` : safe;
  return `${type}; filename="${full}"; filename*=UTF-8''${encodeURIComponent(full)}`;
}

/** Name of the document checklist PDF: "Evrak listesi - Application number.pdf". */
export function buildChecklistPdfFileName(referenceCode: string): string {
  return `Evrak listesi - ${sanitizeNamePart(referenceCode, 40) || "Basvuru"}.pdf`;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

export function extensionForMime(mime: string): string | null {
  return EXTENSION_BY_MIME[mime] ?? null;
}

/**
 * Cleans the name of a file uploaded by the customer for DISPLAY purposes only
 * (never used as a storage path).
 */
export function sanitizeDisplayFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned === "" || cleaned === "." || cleaned === ".." ? "dosya" : cleaned;
}
