import { describe, expect, it } from "vitest";
import {
  canAddExtraDocument,
  DEFAULT_EXTRA_DOCUMENT_LIMIT,
  EXTRA_DOCUMENT_STATUSES,
  extraDocumentLimitFrom,
  showsExtraDocuments,
  unseenExtraDocumentIds,
  viewedFileIdsFrom,
} from "@/features/documents/extra-documents";
import { decideUpload, type UploadApplication } from "@/features/documents/upload-authorization";
import { APPLICATION_STATUSES } from "@/lib/domain/constants";

/** Extra documents after submission. The database checks the same rule in migration 26. */

describe("extra document rule", () => {
  it("only for a submitted application that is neither concluded nor cancelled", () => {
    expect([...EXTRA_DOCUMENT_STATUSES]).toEqual(["submitted", "in_review", "awaiting_customer", "documents_complete", "awaiting_result"]);
    for (const status of APPLICATION_STATUSES) {
      expect(canAddExtraDocument(status, 0, 10).ok, status).toBe(EXTRA_DOCUMENT_STATUSES.includes(status));
    }
    expect(showsExtraDocuments("draft")).toBe(false);
    expect(showsExtraDocuments("cancelled")).toBe(false);
    expect(showsExtraDocuments("result_communicated")).toBe(true);
  });

  it("up to the limit; disabled when the limit is 0", () => {
    expect(canAddExtraDocument("in_review", 9, 10)).toEqual({ ok: true });
    expect(canAddExtraDocument("in_review", 10, 10)).toMatchObject({ ok: false, message: expect.stringMatching(/En fazla 10 ek evrak/) });
    expect(canAddExtraDocument("in_review", 0, 0)).toMatchObject({ ok: false, message: expect.stringMatching(/kapalı/) });
  });

  it("the limit is read from Settings; the default 10 applies if it is not a number", () => {
    expect(extraDocumentLimitFrom({ "documents.extra_max": 3 })).toBe(3);
    expect(extraDocumentLimitFrom({ "documents.extra_max": 0 })).toBe(0);
    expect(extraDocumentLimitFrom({ "documents.extra_max": -2 })).toBe(0);
    expect(extraDocumentLimitFrom({ "documents.extra_max": "" })).toBe(DEFAULT_EXTRA_DOCUMENT_LIMIT);
    expect(extraDocumentLimitFrom({})).toBe(10);
  });

  it("only the applicant can upload; staff and other customers cannot", () => {
    const app: UploadApplication = { customerId: "musteri-1", status: "in_review", paymentStatus: "verified" };
    const request = { kind: "extra_document" as const, uploadedCount: 0, limit: 10 };
    expect(decideUpload({ id: "musteri-1", isStaff: false }, app, request)).toEqual({ ok: true });
    expect(decideUpload({ id: "personel-1", isStaff: true }, app, request)).toMatchObject({ ok: false, reason: "forbidden" });
    expect(decideUpload({ id: "musteri-2", isStaff: false }, app, request)).toMatchObject({ ok: false, reason: "forbidden" });
    expect(decideUpload({ id: "musteri-1", isStaff: false }, { ...app, status: "draft" }, request)).toMatchObject({ ok: false, reason: "rule" });
    expect(decideUpload({ id: "musteri-1", isStaff: false }, app, { ...request, uploadedCount: 10 })).toMatchObject({ ok: false, reason: "rule" });
  });

  it("'Yeni ek evrak' (new extra document): until a consultant opens or downloads it; only verified extra documents count", () => {
    const files = [
      { id: "a", kind: "extra_document", status: "ready" },
      { id: "b", kind: "extra_document", status: "ready" },
      { id: "c", kind: "extra_document", status: "pending" },
      { id: "d", kind: "document", status: "ready" },
    ];
    const viewed = viewedFileIdsFrom([
      { action: "file.viewed", details: { file_id: "a", kind: "extra_document" } },
      { action: "file.deleted", details: { file_id: "b" } },
      { action: "file.viewed", details: null },
      { action: "file.viewed", details: { file_id: 5 } },
    ]);
    expect([...viewed]).toEqual(["a"]);
    expect(unseenExtraDocumentIds(files, viewed)).toEqual(["b"]);
    expect(unseenExtraDocumentIds(files, new Set(["a", "b"]))).toEqual([]);
  });
});
