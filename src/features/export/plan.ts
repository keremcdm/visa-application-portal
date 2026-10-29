import { extensionForMime, isSafeFolderName, slugForFileName } from "./filenames";

/**
 * Planning the ZIP content: which file goes into which folder under which name.
 *
 * Rules:
 *  - Documents with a mapped category go into the matching category folder.
 *  - Unmapped documents stay at the ZIP's ROOT (no file is lost).
 *  - All active category folders are in the ZIP even if empty; this way every application has the
 *    same folder structure.
 *  - File names are generated from the document name (the name the customer gave is not used); on a name clash
 *    "_2", "_3" are appended. The comparison is case-insensitive (for Windows).
 */

export type ExportFile = {
  id: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
};

export type ExportDocument = {
  /** Document name (the document type's label or a custom name written by the consultant). */
  label: string;
  /** Name of the mapped ZIP folder; null if none. */
  folderName: string | null;
  files: ExportFile[];
};

export type ZipPlanEntry = {
  fileId: string;
  storagePath: string;
  /** Full path inside the ZIP, e.g. "financial evidence/Banka_hesap_dokumu_2.pdf". */
  zipPath: string;
  documentLabel: string;
  expectedSize: number;
};

export type ZipPlan = {
  /** Folder names without a trailing "/". */
  folders: string[];
  entries: ZipPlanEntry[];
  /** Files left out at the planning stage (e.g. unsupported type). */
  rejected: { fileId: string; documentLabel: string; reason: string }[];
};

export type ZipPlanInput = {
  /** Active category folders (in order). */
  categoryFolders: readonly string[];
  documents: readonly ExportDocument[];
  /** File names the system itself adds at the root (reserved to avoid clashes). */
  reservedRootNames: readonly string[];
};

export function buildZipPlan(input: ZipPlanInput): ZipPlan {
  const folders = input.categoryFolders.filter(isSafeFolderName);
  const folderSet = new Set(folders);
  const used = new Set<string>(input.reservedRootNames.map((n) => n.toLowerCase()));
  // No file at the root may have the same name as a folder.
  for (const folder of folders) used.add(folder.toLowerCase());

  const entries: ZipPlanEntry[] = [];
  const rejected: ZipPlan["rejected"] = [];

  const uniquePath = (folder: string | null, base: string, extension: string): string => {
    const prefix = folder ? `${folder}/` : "";
    let counter = 1;
    for (;;) {
      const name = counter === 1 ? `${base}.${extension}` : `${base}_${counter}.${extension}`;
      const candidate = `${prefix}${name}`;
      const key = candidate.toLowerCase();
      if (!used.has(key)) {
        used.add(key);
        return candidate;
      }
      counter++;
    }
  };

  for (const document of input.documents) {
    // Undefined or unsafe folder name => root directory.
    const folder = document.folderName && folderSet.has(document.folderName) ? document.folderName : null;
    const base = slugForFileName(document.label) || "Belge";
    for (const file of document.files) {
      const extension = extensionForMime(file.mimeType);
      if (!extension) {
        rejected.push({ fileId: file.id, documentLabel: document.label, reason: "Desteklenmeyen dosya türü" });
        continue;
      }
      entries.push({
        fileId: file.id,
        storagePath: file.storagePath,
        zipPath: uniquePath(folder, base, extension),
        documentLabel: document.label,
        expectedSize: file.sizeBytes,
      });
    }
  }

  return { folders, entries, rejected };
}
