import { strToU8, Zip, ZipPassThrough } from "fflate";
import type { ZipPlan, ZipPlanEntry } from "./plan";

/**
 * Turns the planned files into a single ZIP.
 *
 * - Files are added without compression (store): PDF/JPEG/PNG are already compressed and
 *   the original bytes are kept exactly.
 * - No file that could not be fetched is skipped silently: unless `allowPartial`, NO ZIP is produced and the
 *   missing items are listed; with `allowPartial` a missing-files report is added to the ZIP's root.
 */

export const MISSING_REPORT_FILE_NAME = "EKSIK_DOSYALAR_RAPORU.txt";

export type ZipFailure = {
  kind: "document" | "form_pdf";
  /** Document name (shown to the consultant). */
  label: string;
  /** The path the file must have inside the ZIP. */
  zipPath: string;
  reason: string;
};

export type ZipBuildInput = {
  plan: ZipPlan;
  fetchFile: (entry: ZipPlanEntry) => Promise<Uint8Array>;
  /** The filled-in application form; if null the form is left out entirely. */
  formPdf: { fileName: string; generate: () => Promise<Uint8Array> } | null;
  allowPartial: boolean;
  maxTotalBytes: number;
  generatedAt: Date;
};

export type ZipBuildResult =
  | { status: "ok" | "partial"; bytes: Uint8Array; includedPaths: string[]; failures: ZipFailure[] }
  | { status: "failed"; reason: "missing_files" | "too_large"; failures: ZipFailure[] };

function buildReport(failures: readonly ZipFailure[], generatedAt: Date): Uint8Array {
  const lines = [
    "EKSİK DOSYALAR RAPORU",
    `Oluşturulma: ${generatedAt.toISOString()}`,
    "",
    "Aşağıdaki dosyalar bu ZIP arşivine EKLENEMEDİ. Arşiv eksiktir.",
    "",
    ...failures.map((f, i) => `${i + 1}. ${f.label}\r\n   Beklenen konum: ${f.zipPath}\r\n   Neden: ${f.reason}`),
    "",
  ];
  // BOM: so Windows Notepad shows Turkish characters correctly.
  return strToU8(`﻿${lines.join("\r\n")}`);
}

export async function buildZip(input: ZipBuildInput): Promise<ZipBuildResult> {
  const failures: ZipFailure[] = input.plan.rejected.map((r) => ({
    kind: "document",
    label: r.documentLabel,
    zipPath: "(plana alınmadı)",
    reason: r.reason,
  }));

  const expectedTotal = input.plan.entries.reduce((sum, e) => sum + Math.max(0, e.expectedSize), 0);
  if (expectedTotal > input.maxTotalBytes) {
    return { status: "failed", reason: "too_large", failures };
  }

  const chunks: Uint8Array[] = [];
  let zipError: Error | null = null;
  let finished = false;
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      zipError = error;
      return;
    }
    chunks.push(chunk);
    if (final) finished = true;
  });

  const add = (zipPath: string, data: Uint8Array) => {
    const file = new ZipPassThrough(zipPath);
    file.mtime = input.generatedAt;
    zip.add(file);
    file.push(data, true);
  };

  for (const folder of input.plan.folders) add(`${folder}/`, new Uint8Array(0));

  const includedPaths: string[] = [];
  let total = 0;

  for (const entry of input.plan.entries) {
    let data: Uint8Array;
    try {
      data = await input.fetchFile(entry);
    } catch {
      failures.push({ kind: "document", label: entry.documentLabel, zipPath: entry.zipPath, reason: "Dosya depolama alanından alınamadı." });
      continue;
    }
    if (data.byteLength === 0) {
      failures.push({ kind: "document", label: entry.documentLabel, zipPath: entry.zipPath, reason: "Dosya boş." });
      continue;
    }
    if (entry.expectedSize > 0 && data.byteLength !== entry.expectedSize) {
      failures.push({
        kind: "document",
        label: entry.documentLabel,
        zipPath: entry.zipPath,
        reason: "Dosyanın boyutu kayıtlı boyutla uyuşmuyor; dosya bozulmuş olabilir.",
      });
      continue;
    }
    total += data.byteLength;
    if (total > input.maxTotalBytes) {
      return { status: "failed", reason: "too_large", failures };
    }
    add(entry.zipPath, data);
    includedPaths.push(entry.zipPath);
  }

  if (input.formPdf) {
    try {
      const pdf = await input.formPdf.generate();
      add(input.formPdf.fileName, pdf);
      includedPaths.push(input.formPdf.fileName);
    } catch {
      failures.push({
        kind: "form_pdf",
        label: "Doldurulmuş başvuru formu",
        zipPath: input.formPdf.fileName,
        reason: "Başvuru formu PDF'i oluşturulamadı.",
      });
    }
  }

  if (failures.length > 0 && !input.allowPartial) {
    return { status: "failed", reason: "missing_files", failures };
  }
  if (failures.length > 0) {
    add(MISSING_REPORT_FILE_NAME, buildReport(failures, input.generatedAt));
  }

  zip.end();
  if (zipError) throw zipError;
  if (!finished) throw new Error("ZIP arşivi tamamlanamadı.");

  const size = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { status: failures.length > 0 ? "partial" : "ok", bytes, includedPaths, failures };
}
