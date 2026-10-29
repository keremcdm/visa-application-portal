import "server-only";
import { DEFAULT_MAX_FILE_BYTES } from "@/features/documents/file-validation";

function positiveInt(value: string | undefined, fallback: number, max: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}

/** Maximum size of a single file. Must match the Supabase bucket limit (migration: 10 MB). */
export function maxUploadBytes(): number {
  return positiveInt(process.env.UPLOAD_MAX_FILE_BYTES, DEFAULT_MAX_FILE_BYTES, 50 * 1024 * 1024);
}

/** Total size that can be processed in memory for a ZIP export. */
export function maxExportBytes(): number {
  return positiveInt(process.env.EXPORT_MAX_TOTAL_BYTES, 300 * 1024 * 1024, 1024 * 1024 * 1024);
}
