import { describe, expect, it } from "vitest";
import {
  canCancelApplication,
  canManageAppointment,
  canMarkDocumentsComplete,
  canReopenApplication,
  canUndoDocumentsComplete,
  describeOutstanding,
  nextApplicationStatus,
  outstandingCustomerActions,
  type OutstandingActions,
} from "@/features/applications/status-flow";
import type { DocumentSlotState } from "@/features/documents/rules";
import { applicationStatusLabel, appointmentStatusLabel, toApplicationStatus, toAppointmentStatus } from "@/lib/domain/constants";

const NONE: OutstandingActions = { documents: 0, tasks: 0, form: false, any: false };

const slot = (over: Partial<DocumentSlotState> = {}): DocumentSlotState => ({
  requirement: "required",
  outOfScope: false,
  reuploadAllowed: false,
  reviewStatus: "pending",
  maxFiles: 10,
  fileCount: 1,
  ...over,
});

describe("automatic status rule", () => {
  it("draft, cancelled and result sent only change through their own actions", () => {
    for (const status of ["draft", "cancelled", "result_communicated"] as const) {
      expect(nextApplicationStatus(status, "verified", "completed", true), status).toBe(status);
    }
  });

  it("the application stays 'submitted' until the payment is verified; once verified it moves to review", () => {
    expect(nextApplicationStatus("submitted", "under_review", "preferences_submitted", true)).toBe("submitted");
    expect(nextApplicationStatus("submitted", "verified", "preferences_submitted", false)).toBe("in_review");
    // If something is expected from the customer at the moment of verification, it goes straight to that stage.
    expect(nextApplicationStatus("submitted", "verified", "preferences_submitted", true)).toBe("awaiting_customer");
  });

  it("'Müşteriden işlem bekleniyor' while something is expected from the customer, back to review when done", () => {
    expect(nextApplicationStatus("in_review", "verified", "preferences_submitted", true)).toBe("awaiting_customer");
    expect(nextApplicationStatus("awaiting_customer", "verified", "preferences_submitted", false)).toBe("in_review");
  });

  it("'Evraklar tamamlandı' is kept until new work is requested from the customer; the mark is cleared if it is", () => {
    expect(nextApplicationStatus("documents_complete", "verified", "scheduled", false)).toBe("documents_complete");
    expect(nextApplicationStatus("documents_complete", "verified", "scheduled", true)).toBe("awaiting_customer");
    // Once done it does not return to "Evraklar tamamlandı" by itself; the consultant marks it again.
    expect(nextApplicationStatus("awaiting_customer", "verified", "scheduled", false)).toBe("in_review");
  });

  it("'Sonuç bekleniyor' once the appointment took place; back to documents complete if a new date or preference is requested", () => {
    for (const status of ["in_review", "awaiting_customer", "documents_complete"] as const) {
      expect(nextApplicationStatus(status, "verified", "completed", true), status).toBe("awaiting_result");
    }
    expect(nextApplicationStatus("awaiting_result", "verified", "scheduled", false)).toBe("documents_complete");
    expect(nextApplicationStatus("awaiting_result", "verified", "preferences_requested", false)).toBe("documents_complete");
    expect(nextApplicationStatus("awaiting_result", "verified", "preferences_requested", true)).toBe("awaiting_customer");
  });

  it("the rule is stable: applying it to its own result does not change the status", () => {
    const statuses = ["draft", "submitted", "in_review", "awaiting_customer", "documents_complete", "awaiting_result", "result_communicated", "cancelled"] as const;
    for (const status of statuses) {
      for (const payment of ["awaiting_payment", "verified"] as const) {
        for (const appointment of ["preferences_submitted", "scheduled", "completed"] as const) {
          for (const outstanding of [false, true]) {
            const once = nextApplicationStatus(status, payment, appointment, outstanding);
            expect(nextApplicationStatus(once, payment, appointment, outstanding), `${status}/${payment}/${appointment}/${outstanding}`).toBe(once);
          }
        }
      }
    }
  });
});

describe("things expected from the customer", () => {
  it("a document with a reported problem, a re-upload request without a file, an open task and an open form count", () => {
    const actions = outstandingCustomerActions({
      status: "in_review",
      formLocked: false,
      slots: [
        slot({ reviewStatus: "needs_correction" }),
        slot({ reviewStatus: "missing", fileCount: 0 }),
        slot({ reuploadAllowed: true, fileCount: 0 }),
        slot({ reuploadAllowed: true, fileCount: 2 }),
        slot({ reviewStatus: "approved" }),
        // Documents not required (out of scope) and empty optional documents are not counted.
        slot({ reviewStatus: "needs_correction", outOfScope: true }),
        slot({ requirement: "optional", reuploadAllowed: true, fileCount: 0 }),
      ],
      tasks: [{ status: "open" }, { status: "completed" }, { status: "cancelled" }],
    });
    expect(actions).toEqual({ documents: 3, tasks: 1, form: true, any: true });
    expect(describeOutstanding(actions)).toBe("3 belge, 1 görev ve form düzeltmesi");
  });

  it("an open form in a draft is not expected work; empty if there is nothing", () => {
    const actions = outstandingCustomerActions({ status: "draft", formLocked: false, slots: [slot()], tasks: [] });
    expect(actions).toEqual(NONE);
    expect(describeOutstanding(actions)).toBe("");
    expect(describeOutstanding({ documents: 0, tasks: 2, form: false, any: true })).toBe("2 görev");
    expect(describeOutstanding({ documents: 1, tasks: 0, form: true, any: true })).toBe("1 belge ve form düzeltmesi");
  });
});

describe("transitions the consultant makes by hand", () => {
  it("'Evraklar tamamlandı' only while under review and nothing is expected from the customer", () => {
    expect(canMarkDocumentsComplete("in_review", NONE).ok).toBe(true);
    const waiting = canMarkDocumentsComplete("in_review", { documents: 2, tasks: 0, form: false, any: true });
    expect(waiting.ok).toBe(false);
    expect(waiting.ok ? "" : waiting.message).toMatch(/2 belge/);
    expect(canMarkDocumentsComplete("awaiting_customer", NONE).ok).toBe(false);
    expect(canMarkDocumentsComplete("submitted", NONE).ok).toBe(false);
    expect(canMarkDocumentsComplete("documents_complete", NONE).ok).toBe(false);
    expect(canMarkDocumentsComplete("awaiting_result", NONE).ok).toBe(false);
    expect(canUndoDocumentsComplete("documents_complete").ok).toBe(true);
    expect(canUndoDocumentsComplete("in_review").ok).toBe(false);
  });

  it("a draft and an application whose result was sent cannot be cancelled; a cancellation can be undone", () => {
    for (const status of ["submitted", "in_review", "awaiting_customer", "documents_complete", "awaiting_result"] as const) {
      expect(canCancelApplication(status).ok, status).toBe(true);
    }
    for (const status of ["draft", "result_communicated", "cancelled"] as const) {
      expect(canCancelApplication(status).ok, status).toBe(false);
    }
    expect(canReopenApplication("cancelled").ok).toBe(true);
    expect(canReopenApplication("in_review").ok).toBe(false);
  });

  it("appointment actions are available for submitted, ongoing applications", () => {
    for (const status of ["submitted", "in_review", "awaiting_customer", "documents_complete", "awaiting_result"] as const) {
      expect(canManageAppointment(status).ok, status).toBe(true);
    }
    for (const status of ["draft", "cancelled", "result_communicated"] as const) {
      expect(canManageAppointment(status).ok, status).toBe(false);
    }
  });
});

describe("status values from before migration 12", () => {
  it("are mapped to their new counterparts; shown with their old names in the history", () => {
    expect(toApplicationStatus("correction_required")).toBe("awaiting_customer");
    expect(toApplicationStatus("visa_submitted")).toBe("awaiting_result");
    expect(toApplicationStatus("in_review")).toBe("in_review");
    expect(toApplicationStatus("uydurma")).toBeNull();
    expect(toAppointmentStatus("booking_in_progress")).toBe("preferences_submitted");
    expect(applicationStatusLabel("visa_submitted")).toBe("Vize başvurusu yapıldı");
    expect(applicationStatusLabel("awaiting_customer")).toBe("Müşteriden işlem bekleniyor");
    expect(appointmentStatusLabel("booking_in_progress")).toBe("Randevu ayarlanıyor");
    expect(appointmentStatusLabel("completed")).toBe("Randevu gerçekleşti");
  });
});
