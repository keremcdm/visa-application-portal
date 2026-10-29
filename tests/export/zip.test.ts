import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildZip, MISSING_REPORT_FILE_NAME } from "@/features/export/build-zip";
import { bytesToStream, isCompleteDownload } from "@/features/export/stream";
import {
  exportApplicationZip,
  FORM_PDF_ROOT_NAME,
  isValidStoragePath,
  type ExportActor,
  type ExportApplicationData,
  type ExportAuditEvent,
  type ExportDeps,
} from "@/features/export/export-service";
import { buildZipPlan, type ExportDocument } from "@/features/export/plan";
import { minimalSampleForm, TEST_NATIONAL_ID } from "../fixtures/sample-form";

const APP_ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-13T09:30:00Z");
const CATEGORY_FOLDERS = ["accomodation", "financial evidence", "life events", "other", "pasaport", "proof of business", "sponsor"];

/** Synthetic file content: not a real document. */
function fakeBytes(seed: number, length = 64): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => (seed * 31 + i * 7) % 256);
}

let fileCounter = 0;
const store = new Map<string, Uint8Array>();
function file(mimeType: string, extension: string, options: { missing?: boolean; wrongSize?: boolean } = {}) {
  fileCounter++;
  const id = `22222222-2222-4222-8222-${String(fileCounter).padStart(12, "0")}`;
  const storagePath = `${APP_ID}/${id}.${extension}`;
  const bytes = fakeBytes(fileCounter, 64 + fileCounter);
  if (!options.missing) store.set(storagePath, bytes);
  return { id, storagePath, mimeType, sizeBytes: options.wrongSize ? bytes.byteLength + 5 : bytes.byteLength };
}

function sampleDocuments(): ExportDocument[] {
  return [
    { label: "Geçerli pasaport", folderName: "pasaport", files: [file("application/pdf", "pdf"), file("image/jpeg", "jpg")] },
    { label: "Banka hesap dökümü", folderName: "financial evidence", files: [file("application/pdf", "pdf"), file("application/pdf", "pdf")] },
    // Document with an unmapped category: must stay at the root.
    { label: "Eşleşmemiş belge", folderName: null, files: [file("image/png", "png")] },
    // A second document with the same name (e.g. the consultant's custom request): names must not clash.
    { label: "Geçerli pasaport", folderName: "pasaport", files: [file("application/pdf", "pdf")] },
  ];
}

function application(documents: ExportDocument[]): ExportApplicationData {
  return {
    id: APP_ID,
    referenceCode: "VB-2026-000001",
    applicant: { tcNo: TEST_NATIONAL_ID, firstName: "Ali", lastName: "Deneme" },
    formData: minimalSampleForm,
    categoryFolders: CATEGORY_FOLDERS,
    documents,
  };
}

const staff: ExportActor = { id: "staff-1", role: "staff", isActive: true };

function deps(overrides: Partial<ExportDeps> & { actor?: ExportActor | null; data?: ExportApplicationData | null; audit?: ExportAuditEvent[] }): ExportDeps {
  return {
    getActor: async () => (overrides.actor === undefined ? staff : overrides.actor),
    loadApplication: async () => (overrides.data === undefined ? application(sampleDocuments()) : overrides.data),
    downloadFile: async (storagePath) => {
      const bytes = store.get(storagePath);
      if (!bytes) throw new Error("not found");
      return bytes;
    },
    generateFormPdf: async () => ({ fileName: FORM_PDF_ROOT_NAME, bytes: fakeBytes(999, 128) }),
    recordAudit: async (event) => {
      overrides.audit?.push(event);
    },
    now: () => NOW,
    maxTotalBytes: 50 * 1024 * 1024,
    ...overrides,
  };
}

describe("ZIP plan", () => {
  it("puts mapped documents into their folder and unmapped ones at the root", () => {
    const plan = buildZipPlan({ categoryFolders: CATEGORY_FOLDERS, documents: sampleDocuments(), reservedRootNames: [FORM_PDF_ROOT_NAME] });
    expect(plan.folders).toEqual(CATEGORY_FOLDERS);
    expect(plan.entries.map((e) => e.zipPath)).toEqual([
      "pasaport/Gecerli_pasaport.pdf",
      "pasaport/Gecerli_pasaport.jpg",
      "financial evidence/Banka_hesap_dokumu.pdf",
      "financial evidence/Banka_hesap_dokumu_2.pdf",
      "Eslesmemis_belge.png",
      "pasaport/Gecerli_pasaport_2.pdf",
    ]);
  });

  it("puts a document with an undefined or dangerous folder name at the root; never produces a path outside the folder", () => {
    const plan = buildZipPlan({
      categoryFolders: [...CATEGORY_FOLDERS, "../../etc", "a/b"],
      documents: [
        { label: "../../../../Windows/System32/x", folderName: "../../etc", files: [file("application/pdf", "pdf")] },
        { label: "Bilinmeyen klasör", folderName: "boyle-bir-klasor-yok", files: [file("application/pdf", "pdf")] },
      ],
      reservedRootNames: [],
    });
    expect(plan.folders).toEqual(CATEGORY_FOLDERS);
    for (const entry of plan.entries) {
      expect(entry.zipPath).not.toContain("..");
      expect(entry.zipPath).not.toMatch(/^[\\/]/);
      expect(entry.zipPath.split("/").length).toBe(1);
    }
  });

  it("resolves name clashes case-insensitively and does not use reserved root names", () => {
    const plan = buildZipPlan({
      categoryFolders: ["other"],
      documents: [
        { label: "Doldurulmus Basvuru Formu", folderName: null, files: [file("application/pdf", "pdf")] },
        { label: "BELGE", folderName: null, files: [file("application/pdf", "pdf")] },
        { label: "belge", folderName: null, files: [file("application/pdf", "pdf")] },
        { label: "😀", folderName: null, files: [file("application/pdf", "pdf")] },
      ],
      reservedRootNames: [FORM_PDF_ROOT_NAME],
    });
    expect(plan.entries.map((e) => e.zipPath)).toEqual(["Doldurulmus_Basvuru_Formu_2.pdf", "BELGE.pdf", "belge_2.pdf", "Belge_3.pdf"]);
  });

  it("leaves a file of an unsupported type out of the plan and reports it", () => {
    const plan = buildZipPlan({
      categoryFolders: [],
      documents: [{ label: "Tuhaf dosya", folderName: null, files: [{ id: "x", storagePath: "x", mimeType: "application/x-msdownload", sizeBytes: 1 }] }],
      reservedRootNames: [],
    });
    expect(plan.entries).toEqual([]);
    expect(plan.rejected).toHaveLength(1);
  });
});

describe("building the ZIP", () => {
  it("produces the folder structure, root files and form PDF correctly; bytes are kept exactly", async () => {
    const outcome = await exportApplicationZip(deps({}), APP_ID, { allowPartial: false });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;

    expect(outcome.fileName).toBe(`Ali Deneme - ${TEST_NATIONAL_ID}.zip`);
    const entries = unzipSync(outcome.bytes);
    const names = Object.keys(entries).sort();
    expect(names).toEqual(
      [
        ...CATEGORY_FOLDERS.map((f) => `${f}/`),
        "Doldurulmus_Basvuru_Formu.pdf",
        "Eslesmemis_belge.png",
        "financial evidence/Banka_hesap_dokumu.pdf",
        "financial evidence/Banka_hesap_dokumu_2.pdf",
        "pasaport/Gecerli_pasaport.jpg",
        "pasaport/Gecerli_pasaport.pdf",
        "pasaport/Gecerli_pasaport_2.pdf",
      ].sort(),
    );
    // The ZIP itself is not inside a category folder: there is no single wrapper folder at the root.
    expect(names.some((n) => !n.includes("/"))).toBe(true);
    // No entry escapes the archive.
    for (const name of names) {
      expect(name).not.toContain("..");
      expect(name.startsWith("/")).toBe(false);
    }
    expect(outcome.includedCount).toBe(7);
  });

  it("stores the original file content unchanged", async () => {
    const documents: ExportDocument[] = [{ label: "Tek belge", folderName: "other", files: [file("application/pdf", "pdf")] }];
    const original = store.get(documents[0]!.files[0]!.storagePath)!;
    const outcome = await exportApplicationZip(deps({ data: application(documents) }), APP_ID, { allowPartial: false });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    const entries = unzipSync(outcome.bytes);
    expect(Array.from(entries["other/Tek_belge.pdf"]!)).toEqual(Array.from(original));
  });

  it("produces no ZIP if a file is missing and reports the missing items clearly", async () => {
    const audit: ExportAuditEvent[] = [];
    const documents: ExportDocument[] = [
      { label: "Mevcut belge", folderName: "other", files: [file("application/pdf", "pdf")] },
      { label: "Kayıp belge", folderName: "pasaport", files: [file("application/pdf", "pdf", { missing: true })] },
      { label: "Bozuk belge", folderName: null, files: [file("image/png", "png", { wrongSize: true })] },
    ];
    const outcome = await exportApplicationZip(deps({ data: application(documents), audit }), APP_ID, { allowPartial: false });
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.reason).toBe("missing_files");
    expect(outcome.failures.map((f) => f.label)).toEqual(["Kayıp belge", "Bozuk belge"]);
    expect(outcome.failures[0]!.zipPath).toBe("pasaport/Kayip_belge.pdf");
    expect("bytes" in outcome).toBe(false);
    expect(audit).toEqual([expect.objectContaining({ outcome: "failed", failureCount: 2, reason: "missing_files" })]);
  });

  it("downloads with missing files if the consultant explicitly asks and adds a report to the archive", async () => {
    const audit: ExportAuditEvent[] = [];
    const documents: ExportDocument[] = [
      { label: "Mevcut belge", folderName: "other", files: [file("application/pdf", "pdf")] },
      { label: "Kayıp belge", folderName: "pasaport", files: [file("application/pdf", "pdf", { missing: true })] },
    ];
    const outcome = await exportApplicationZip(deps({ data: application(documents), audit }), APP_ID, { allowPartial: true });
    expect(outcome.status).toBe("partial");
    if (outcome.status !== "partial") return;
    const entries = unzipSync(outcome.bytes);
    expect(Object.keys(entries)).toContain(MISSING_REPORT_FILE_NAME);
    expect(Object.keys(entries)).toContain("other/Mevcut_belge.pdf");
    expect(Object.keys(entries)).not.toContain("pasaport/Kayip_belge.pdf");
    const report = strFromU8(entries[MISSING_REPORT_FILE_NAME]!);
    expect(report).toContain("Kayıp belge");
    expect(report).toContain("pasaport/Kayip_belge.pdf");
    expect(audit[0]).toMatchObject({ outcome: "partial", failureCount: 1 });
  });

  it("reports the form PDF as missing if it cannot be generated", async () => {
    const failing = deps({
      generateFormPdf: async () => {
        throw new Error("şablon okunamadı");
      },
    });
    const strict = await exportApplicationZip(failing, APP_ID, { allowPartial: false });
    expect(strict.status).toBe("failed");
    if (strict.status === "failed") expect(strict.failures.map((f) => f.kind)).toEqual(["form_pdf"]);

    const partial = await exportApplicationZip(failing, APP_ID, { allowPartial: true });
    expect(partial.status).toBe("partial");
    if (partial.status === "partial") {
      const entries = unzipSync(partial.bytes);
      expect(Object.keys(entries)).not.toContain(FORM_PDF_ROOT_NAME);
      expect(Object.keys(entries)).toContain(MISSING_REPORT_FILE_NAME);
    }
  });

  it("produces no ZIP if the total size limit is exceeded", async () => {
    const outcome = await exportApplicationZip(deps({ maxTotalBytes: 100 }), APP_ID, { allowPartial: true });
    expect(outcome).toMatchObject({ status: "failed", reason: "too_large" });
  });

  it("produces a valid ZIP with the folder structure and form even without any documents", async () => {
    const outcome = await exportApplicationZip(deps({ data: application([]) }), APP_ID, { allowPartial: false });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(Object.keys(unzipSync(outcome.bytes)).sort()).toEqual([...CATEGORY_FOLDERS.map((f) => `${f}/`), FORM_PDF_ROOT_NAME].sort());
  });

  it("uses the application number in the ZIP name if no national ID number is stored", async () => {
    const data = { ...application([]), applicant: { tcNo: "", firstName: "Ali", lastName: "Deneme" } };
    const outcome = await exportApplicationZip(deps({ data }), APP_ID, { allowPartial: false });
    expect(outcome.status === "ok" && outcome.fileName).toBe("Ali Deneme - VB-2026-000001.zip");
  });

  it("buildZip: a storage error does not throw; it is added to the error list", async () => {
    const plan = buildZipPlan({
      categoryFolders: [],
      documents: [{ label: "X", folderName: null, files: [{ id: "a", storagePath: "p", mimeType: "application/pdf", sizeBytes: 10 }] }],
      reservedRootNames: [],
    });
    const result = await buildZip({
      plan,
      fetchFile: async () => {
        throw new Error("ağ hatası");
      },
      formPdf: null,
      allowPartial: false,
      maxTotalBytes: 1000,
      generatedAt: NOW,
    });
    expect(result.status).toBe("failed");
  });
});

describe("ZIP indirme yetkisi", () => {
  it("rejects a user who is not signed in", async () => {
    const audit: ExportAuditEvent[] = [];
    expect(await exportApplicationZip(deps({ actor: null, audit }), APP_ID, { allowPartial: false })).toEqual({ status: "unauthenticated" });
    expect(audit).toEqual([]);
  });

  it("rejects a user with the customer role (even for their own application)", async () => {
    let loaded = false;
    const outcome = await exportApplicationZip(
      deps({
        actor: { id: "customer-1", role: "customer", isActive: true },
        loadApplication: async () => {
          loaded = true;
          return application([]);
        },
      }),
      APP_ID,
      { allowPartial: false },
    );
    expect(outcome).toEqual({ status: "forbidden" });
    // The authorization check happens BEFORE data is loaded.
    expect(loaded).toBe(false);
  });

  it("rejects disabled staff", async () => {
    const outcome = await exportApplicationZip(deps({ actor: { id: "staff-2", role: "staff", isActive: false } }), APP_ID, { allowPartial: false });
    expect(outcome).toEqual({ status: "forbidden" });
  });

  it("returns not_found if the application is not found (or RLS grants no access)", async () => {
    expect(await exportApplicationZip(deps({ data: null }), APP_ID, { allowPartial: false })).toEqual({ status: "not_found" });
  });

  it("rejects an invalid application id without any data access", async () => {
    let called = false;
    const outcome = await exportApplicationZip(
      deps({
        getActor: async () => {
          called = true;
          return staff;
        },
      }),
      "../../etc/passwd",
      { allowPartial: false },
    );
    expect(outcome).toEqual({ status: "invalid_request" });
    expect(called).toBe(false);
  });

  it("does not download a storage path pointing to another application's folder", async () => {
    const otherApp = "33333333-3333-4333-8333-333333333333";
    const foreignPath = `${otherApp}/22222222-2222-4222-8222-000000000001.pdf`;
    store.set(foreignPath, fakeBytes(1));
    const downloaded: string[] = [];
    const data = application([
      { label: "Yabancı dosya", folderName: null, files: [{ id: "f", storagePath: foreignPath, mimeType: "application/pdf", sizeBytes: 64 }] },
      { label: "Yol kaçışı", folderName: null, files: [{ id: "g", storagePath: `${APP_ID}/../${otherApp}/x.pdf`, mimeType: "application/pdf", sizeBytes: 64 }] },
    ]);
    const outcome = await exportApplicationZip(
      deps({
        data,
        downloadFile: async (p) => {
          downloaded.push(p);
          return store.get(p)!;
        },
      }),
      APP_ID,
      { allowPartial: false },
    );
    expect(outcome.status).toBe("failed");
    expect(downloaded).toEqual([]);
  });

  it("validates the storage path format", () => {
    expect(isValidStoragePath(`${APP_ID}/22222222-2222-4222-8222-000000000001.pdf`, APP_ID)).toBe(true);
    expect(isValidStoragePath(`${APP_ID}/22222222-2222-4222-8222-000000000001.exe`, APP_ID)).toBe(false);
    expect(isValidStoragePath(`${APP_ID}/../x.pdf`, APP_ID)).toBe(false);
    expect(isValidStoragePath(`/${APP_ID}/22222222-2222-4222-8222-000000000001.pdf`, APP_ID)).toBe(false);
    expect(isValidStoragePath(`33333333-3333-4333-8333-333333333333/22222222-2222-4222-8222-000000000001.pdf`, APP_ID)).toBe(false);
  });
});

describe("streaming the ZIP in chunks", () => {
  const readAll = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    const parts: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }
    return parts;
  };

  it("bytes arrive in order and intact, in chunks within the limit", async () => {
    const bytes = Uint8Array.from({ length: 10_000 }, (_, i) => i % 251);
    const parts = await readAll(bytesToStream(bytes, 4096));
    expect(parts.map((p) => p.byteLength)).toEqual([4096, 4096, 1808]);
    const joined = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
    let offset = 0;
    for (const part of parts) {
      joined.set(part, offset);
      offset += part.byteLength;
    }
    expect(joined).toEqual(bytes);
    expect(await readAll(bytesToStream(new Uint8Array(0)))).toEqual([]);
  });

  it("an incomplete or empty download is not accepted", () => {
    expect(isCompleteDownload("10000", 10_000)).toBe(true);
    expect(isCompleteDownload("10000", 9_000)).toBe(false);
    expect(isCompleteDownload(null, 5)).toBe(true);
    expect(isCompleteDownload(null, 0)).toBe(false);
    expect(isCompleteDownload("abc", 5)).toBe(false);
  });
});
