import { describe, expect, it } from "vitest";
import type { DocumentSlotState } from "@/features/documents/rules";
import { decideUpload, MAX_RECEIPTS, type UploadApplication } from "@/features/documents/upload-authorization";

/** Unauthorized access tests for file uploads. */

const OWNER = { id: "musteri-1", isStaff: false };
const OTHER_CUSTOMER = { id: "musteri-2", isStaff: false };
const STAFF = { id: "personel-1", isStaff: true };

const draft: UploadApplication = { customerId: "musteri-1", status: "draft", paymentStatus: "not_due" };
const submitted: UploadApplication = { customerId: "musteri-1", status: "submitted", paymentStatus: "awaiting_payment" };

const slot = (overrides: Partial<DocumentSlotState> = {}): DocumentSlotState => ({
  requirement: "required",
  outOfScope: false,
  reuploadAllowed: false,
  reviewStatus: "pending",
  maxFiles: 10,
  fileCount: 0,
  ...overrides,
});

describe("document upload permission", () => {
  it("another customer cannot upload to any target", () => {
    expect(decideUpload(OTHER_CUSTOMER, draft, { kind: "document", slot: slot() })).toMatchObject({ ok: false, reason: "forbidden" });
    expect(decideUpload(OTHER_CUSTOMER, draft, { kind: "staff_attachment", slot: slot() })).toMatchObject({ ok: false, reason: "forbidden" });
    expect(decideUpload(OTHER_CUSTOMER, submitted, { kind: "payment_receipt", receiptUploadEnabled: true, existingReceiptCount: 0 })).toMatchObject({
      ok: false,
      reason: "forbidden",
    });
  });

  it("an unauthorized user cannot tell whether the slot exists (the permission check comes first)", () => {
    expect(decideUpload(OTHER_CUSTOMER, draft, { kind: "document", slot: null })).toMatchObject({ ok: false, reason: "forbidden" });
  });

  it("the applicant can upload in a draft; after submission only to a reopened document", () => {
    expect(decideUpload(OWNER, draft, { kind: "document", slot: slot() })).toEqual({ ok: true });
    expect(decideUpload(OWNER, submitted, { kind: "document", slot: slot() })).toMatchObject({ ok: false, reason: "rule" });
    expect(decideUpload(OWNER, submitted, { kind: "document", slot: slot({ reuploadAllowed: true }) })).toEqual({ ok: true });
  });

  it("a customer cannot put a file into the slot for documents staff send to the customer", () => {
    expect(decideUpload(OWNER, draft, { kind: "staff_attachment", slot: slot() })).toMatchObject({ ok: false, reason: "forbidden" });
    expect(decideUpload(STAFF, submitted, { kind: "staff_attachment", slot: slot() })).toEqual({ ok: true });
  });

  it("a document slot that does not exist or belongs to another application is rejected", () => {
    expect(decideUpload(OWNER, draft, { kind: "document", slot: null })).toMatchObject({ ok: false, reason: "not_found" });
    expect(decideUpload(STAFF, draft, { kind: "document", slot: null })).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("staff can add a document on the customer's behalf but cannot exceed the file count limit", () => {
    expect(decideUpload(STAFF, submitted, { kind: "document", slot: slot() })).toEqual({ ok: true });
    expect(decideUpload(STAFF, submitted, { kind: "document", slot: slot({ fileCount: 10 }) })).toMatchObject({ ok: false, reason: "rule" });
  });
});

describe("permission to upload the visa outcome screenshot", () => {
  const awaiting: UploadApplication = { customerId: "musteri-1", status: "awaiting_result", paymentStatus: "verified" };

  it("only staff can upload, after the visa application has been made; never the customer", () => {
    expect(decideUpload(STAFF, awaiting, { kind: "visa_result" })).toEqual({ ok: true });
    expect(decideUpload(STAFF, { ...awaiting, status: "result_communicated" }, { kind: "visa_result" })).toEqual({ ok: true });
    expect(decideUpload(OWNER, awaiting, { kind: "visa_result" })).toMatchObject({ ok: false, reason: "forbidden" });
    expect(decideUpload(OTHER_CUSTOMER, awaiting, { kind: "visa_result" })).toMatchObject({ ok: false, reason: "forbidden" });
    expect(decideUpload(STAFF, submitted, { kind: "visa_result" })).toMatchObject({ ok: false, reason: "rule" });
    expect(decideUpload(STAFF, draft, { kind: "visa_result" })).toMatchObject({ ok: false, reason: "rule" });
  });
});

describe("permission to upload the appointment letter", () => {
  it("only staff can upload, to a submitted application that is not cancelled; never the customer", () => {
    const scheduled: UploadApplication = { customerId: "musteri-1", status: "documents_complete", paymentStatus: "verified" };
    expect(decideUpload(STAFF, scheduled, { kind: "appointment_letter" })).toEqual({ ok: true });
    expect(decideUpload(STAFF, submitted, { kind: "appointment_letter" })).toEqual({ ok: true });
    expect(decideUpload(OWNER, scheduled, { kind: "appointment_letter" })).toMatchObject({ ok: false, reason: "forbidden" });
    expect(decideUpload(OTHER_CUSTOMER, scheduled, { kind: "appointment_letter" })).toMatchObject({ ok: false, reason: "forbidden" });
    expect(decideUpload(STAFF, draft, { kind: "appointment_letter" })).toMatchObject({ ok: false, reason: "rule" });
    expect(decideUpload(STAFF, { ...scheduled, status: "cancelled" }, { kind: "appointment_letter" })).toMatchObject({ ok: false, reason: "rule" });
  });
});

describe("permission to upload a receipt", () => {
  const request = (overrides = {}) => ({ kind: "payment_receipt" as const, receiptUploadEnabled: true, existingReceiptCount: 0, ...overrides });

  it("only the applicant; can upload in a draft or while the payment is pending", () => {
    expect(decideUpload(OWNER, submitted, request())).toEqual({ ok: true });
    expect(decideUpload(STAFF, submitted, request())).toMatchObject({ ok: false, reason: "forbidden" });
    // In a draft a receipt can optionally be uploaded in the "Ücret" (fee) step.
    expect(decideUpload(OWNER, draft, request())).toEqual({ ok: true });
    expect(decideUpload(STAFF, draft, request())).toMatchObject({ ok: false, reason: "forbidden" });
    expect(decideUpload(OTHER_CUSTOMER, draft, request())).toMatchObject({ ok: false, reason: "forbidden" });
    expect(decideUpload(OWNER, { ...submitted, paymentStatus: "verified" }, request())).toMatchObject({ ok: false, reason: "rule" });
    expect(decideUpload(OWNER, { ...submitted, status: "cancelled", paymentStatus: "not_due" }, request())).toMatchObject({ ok: false, reason: "rule" });
  });

  it("cannot upload if the feature is off or the limit is reached", () => {
    expect(decideUpload(OWNER, submitted, request({ receiptUploadEnabled: false }))).toMatchObject({ ok: false, reason: "rule" });
    expect(decideUpload(OWNER, draft, request({ receiptUploadEnabled: false }))).toMatchObject({ ok: false, reason: "rule" });
    expect(decideUpload(OWNER, draft, request({ existingReceiptCount: MAX_RECEIPTS }))).toMatchObject({ ok: false, reason: "rule" });
    expect(decideUpload(OWNER, submitted, request({ existingReceiptCount: MAX_RECEIPTS }))).toMatchObject({ ok: false, reason: "rule" });
  });
});
