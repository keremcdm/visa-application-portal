import { describe, expect, it } from "vitest";
import { ARCHIVE_AFTER_DAYS, finishedAt, isArchived } from "@/features/applications/archive";
import { appointmentMapsLink, showUpcomingAppointment } from "@/features/appointments/calendar";
import { buildCustomerTodos, isPaymentDue, type CustomerTodoInput } from "@/features/applications/customer-todos";
import {
  buildApplicationProgress,
  extraDocumentsFrom,
  istanbulDate,
  PROGRESS_STEP_NAMES,
  progressAlertText,
  type ExtraDocuments,
  type ProgressInput,
} from "@/features/applications/progress";
import type { DocumentSlotState } from "@/features/documents/rules";
import { formatNotificationTime, notificationIcon } from "@/features/notifications/display";
import { APPLICATION_STATUSES } from "@/lib/domain/constants";

const NONE: ExtraDocuments = { requested: false, outstanding: false, outstandingCount: 0 };

const base: ProgressInput = {
  status: "submitted",
  appointmentStatus: "preferences_submitted",
  paymentStatus: "awaiting_payment",
  paymentNote: null,
  paymentReviewedAt: null,
  submittedAt: "2026-10-13T21:37:00Z", // Istanbul: 14.10.2026 00:37
  appointmentAt: null,
  history: [{ status: "submitted", changedAt: "2026-10-13T21:37:00Z" }],
  visaOutcomeAt: null,
  extraDocuments: NONE,
  formOpen: false,
  openTasks: [],
};
/** An application with a verified payment (for the stages after review). */
const paid: ProgressInput = { ...base, paymentStatus: "verified", paymentReviewedAt: "2026-10-14T08:00:00Z" };

const active = (input: ProgressInput) => {
  const progress = buildApplicationProgress(input);
  if (progress.kind !== "active") throw new Error(`beklenmeyen: ${progress.kind}`);
  return progress;
};
const states = (input: ProgressInput) => active(input).steps.map((s) => `${s.key}:${s.state}`);
const current = (input: ProgressInput) => {
  const progress = active(input);
  return progress.currentIndex === null ? null : progress.steps[progress.currentIndex]!;
};

describe("customer panel — progress timeline (7 steps)", () => {
  it("the timeline has 7 steps: received, payment, review, extra documents, appointment, appointment day, result", () => {
    expect(active(base).steps.map((s) => s.key)).toEqual(["received", "payment", "review", "extra_documents", "appointment", "lodged", "result"]);
    expect(Object.keys(PROGRESS_STEP_NAMES)).toHaveLength(7);
    // Pending steps show with their short descriptive sentences.
    expect(active(base).steps.slice(2).map((s) => s.label)).toEqual([
      "Başvurunuz inceleniyor",
      "Ek evrak istendi",
      "Randevunuz oluşturuldu",
      "Başvurunuz tamamlandı",
      "Başvurunuz sonuçlandı",
    ]);
  });

  it("'under review' is not shown until the payment is verified; the card stays on the payment step (E1)", () => {
    expect(states(base)).toEqual([
      "received:done",
      "payment:current",
      "review:pending",
      "extra_documents:pending",
      "appointment:pending",
      "lodged:pending",
      "result:pending",
    ]);
    expect(current(base)).toMatchObject({ title: "Ödemeniz bekleniyor", meta: "Devam ediyor" });
    expect(current(base)!.description).toMatch(/Ödemeyi yaptım/);
    expect(active(base).steps[0]).toMatchObject({ state: "done", meta: "14.10.2026" });
    // Payment reported: being checked.
    expect(current({ ...base, paymentStatus: "under_review" })).toMatchObject({ title: "Ödemeniz kontrol ediliyor", meta: "Kontrol ediliyor" });
    expect(active({ ...base, paymentStatus: "under_review" }).alerts).toEqual([]);
  });

  it("if the payment could not be verified the payment step has a red exclamation and the explanation is under 'Sizden beklenenler' (H1)", () => {
    const rejected = { ...base, paymentStatus: "rejected" as const, paymentNote: " Tutar eksik görünüyor. " };
    expect(current(rejected)).toMatchObject({ key: "payment", state: "attention", title: "Ödemeniz doğrulanamadı", meta: "İşlem bekleniyor" });
    expect(active(rejected).alerts).toEqual([{ kind: "payment_rejected", note: "Tutar eksik görünüyor." }]);
    expect(progressAlertText({ kind: "payment_rejected", note: "Tutar eksik görünüyor." }).text).toBe("Danışmanınızın açıklaması: Tutar eksik görünüyor.");
  });

  it("once the payment is verified step 2 is completed with its date and review continues", () => {
    const review = { ...paid, status: "in_review" as const };
    expect(states(review).slice(0, 3)).toEqual(["received:done", "payment:done", "review:current"]);
    expect(active(review).steps[1]).toMatchObject({ label: "Ödemeniz doğrulandı", meta: "14.10.2026" });
    expect(current(review)).toMatchObject({ title: "Başvurunuz inceleniyor" });
    expect(active(review).steps[3]).toMatchObject({ key: "extra_documents", state: "pending", label: "Ek evrak istendi", meta: "Bekliyor" });
  });

  it("while an extra document, form correction or task is pending, the 'Ek evrak' step is current with a red exclamation; each item is listed separately (H5, H6, H14)", () => {
    const waiting = {
      ...paid,
      status: "awaiting_customer" as const,
      extraDocuments: { requested: true, outstanding: true, outstandingCount: 2 },
      formOpen: true,
      openTasks: ["Pasaportunuzun aslını ofise getiriniz"],
    };
    expect(states(waiting)).toEqual([
      "received:done",
      "payment:done",
      "review:done",
      "extra_documents:attention",
      "appointment:pending",
      "lodged:pending",
      "result:pending",
    ]);
    expect(current(waiting)).toMatchObject({ key: "extra_documents", title: "Sizden işlem bekleniyor", meta: "İşlem bekleniyor" });
    expect(active(waiting).alerts).toEqual([
      { kind: "documents", count: 2 },
      { kind: "form" },
      { kind: "task", title: "Pasaportunuzun aslını ofise getiriniz" },
    ]);
    expect(progressAlertText({ kind: "task", title: "X" })).toEqual({ title: "Danışmanınız sizden bir işlem talep etti", text: "X" });
    expect(progressAlertText({ kind: "form" }).text).toMatch(/Formu düzenlemeyi tamamladım/);
    expect(progressAlertText({ kind: "documents", count: 1 }).title).toBe("1 belge için işlem bekleniyor");
    // A task alone is enough too.
    expect(current({ ...paid, status: "awaiting_customer", openTasks: ["Görev"] })).toMatchObject({ key: "extra_documents", state: "attention" });
  });

  it("if documents are complete but there is no appointment it says 'Randevunuz danışmanınız tarafından bildirilecek'; appointment created is not shown (H9)", () => {
    const complete = { ...paid, status: "documents_complete" as const };
    expect(states(complete)).toEqual([
      "received:done",
      "payment:done",
      "review:done",
      "extra_documents:done",
      "appointment:current",
      "lodged:pending",
      "result:pending",
    ]);
    expect(current(complete)).toMatchObject({ label: "Randevunuz bildirilecek", title: "Randevunuz danışmanınız tarafından bildirilecek" });
    expect(active(complete).steps[3]).toMatchObject({ meta: "Gerekmedi" });
    expect(active(complete).steps.some((s) => s.label === "Randevunuz oluşturuldu")).toBe(false);
  });

  it("if the appointment was sent the appointment step is completed with its date; the appointment day is awaited", () => {
    const scheduled = { ...paid, status: "documents_complete" as const, appointmentStatus: "scheduled" as const, appointmentAt: "2026-11-05T07:30:00Z" };
    expect(active(scheduled).steps.map((s) => s.state)).toEqual(["done", "done", "done", "done", "done", "current", "pending"]);
    expect(active(scheduled).steps[4]).toMatchObject({ label: "Randevunuz oluşturuldu", meta: "05.11.2026" });
    expect(current(scheduled)).toMatchObject({ label: "Randevu gününüz bekleniyor", title: "Randevunuz oluşturuldu" });
    expect(current(scheduled)!.description).toMatch(/05\.11\.2026/);
  });

  it("if new appointment preferences are requested the appointment step has a red exclamation and the card says so", () => {
    const requested = { ...paid, status: "documents_complete" as const, appointmentStatus: "preferences_requested" as const };
    expect(current(requested)).toMatchObject({ key: "appointment", state: "attention", title: "Yeni randevu tercihi bekleniyor" });
    expect(active(requested).alerts).toEqual([{ kind: "appointment_preferences" }]);
    // The exclamation also shows if requested during review.
    expect(active({ ...paid, status: "in_review", appointmentStatus: "preferences_requested" }).steps[4]).toMatchObject({ state: "attention" });
  });

  it("if the requested extra documents were completed the step keeps a tick (with its date if known)", () => {
    const done = active({
      ...paid,
      status: "documents_complete",
      history: [...base.history, { status: "in_review", changedAt: "2026-10-14T08:00:00Z" }, { status: "correction_required", changedAt: "2026-10-15T08:00:00Z" }],
    });
    expect(done.steps[3]).toMatchObject({ key: "extra_documents", state: "done", label: "Ek evrak istendi", meta: "15.10.2026" });
    const requestedOnly = active({ ...paid, status: "documents_complete", extraDocuments: { requested: true, outstanding: false, outstandingCount: 0 } });
    expect(requestedOnly.steps[3]).toMatchObject({ state: "done", meta: "Tamamlandı" });
  });

  it("while the result is awaited the last step is ongoing; once the result is sent all steps are complete", () => {
    expect(current({ ...paid, status: "awaiting_result", appointmentStatus: "completed" })).toMatchObject({ key: "result", title: "Sonuç bekleniyor" });
    const done = active({ ...paid, status: "result_communicated", appointmentStatus: "completed", visaOutcomeAt: "2026-11-20T09:00:00Z" });
    expect(done.currentIndex).toBeNull();
    expect(done.completed).toBe(7);
    expect(done.steps.at(-1)).toMatchObject({ label: "Başvurunuz sonuçlandı", meta: "20.11.2026" });
  });

  it("in every state there is at most one 'current step'; earlier ones are done or have an exclamation", () => {
    for (const status of APPLICATION_STATUSES) {
      if (status === "draft" || status === "cancelled") continue;
      for (const payment of ["awaiting_payment", "under_review", "verified", "rejected"] as const) {
        const progress = active({ ...base, status, paymentStatus: payment, openTasks: status === "awaiting_customer" ? ["Görev"] : [] });
        const label = `${status}/${payment}`;
        expect(progress.steps.filter((s) => s.state === "current").length, label).toBeLessThanOrEqual(1);
        if (progress.currentIndex === null) continue;
        expect(progress.steps.slice(0, progress.currentIndex).every((s) => s.state === "done" || s.state === "attention"), label).toBe(true);
      }
    }
  });

  it("for a cancelled application the step where it was cancelled shows a red cross; no warning is shown", () => {
    const progress = buildApplicationProgress({
      ...paid,
      status: "cancelled",
      appointmentStatus: "scheduled",
      appointmentAt: "2026-11-05T07:30:00Z",
      openTasks: ["Eski görev"],
      history: [
        { status: "submitted", changedAt: "2026-10-13T21:37:00Z" },
        { status: "in_review", changedAt: "2026-10-14T08:00:00Z" },
        { status: "documents_complete", changedAt: "2026-10-15T08:00:00Z" },
        { status: "cancelled", changedAt: "2026-10-16T08:00:00Z" },
      ],
    });
    if (progress.kind !== "cancelled") throw new Error("iptal bekleniyordu");
    expect(progress.steps.map((s) => s.state)).toEqual(["done", "done", "done", "done", "done", "cancelled", "pending"]);
    expect(progress.steps[5]).toMatchObject({ meta: "İptal edildi" });
    expect(progress.alerts).toEqual([]);
    // If cancelled while the payment was pending, the cross is on the payment step.
    const early = buildApplicationProgress({ ...base, status: "cancelled", history: [...base.history, { status: "cancelled", changedAt: "2026-10-14T08:00:00Z" }] });
    expect(early.steps.map((s) => s.state)).toEqual(["done", "cancelled", "pending", "pending", "pending", "pending", "pending"]);
  });

  it("no text implies that the company makes the visa decision", () => {
    for (const status of APPLICATION_STATUSES) {
      const progress = buildApplicationProgress({ ...paid, status, openTasks: ["Görev"] });
      for (const step of progress.steps) expect(`${step.title} ${step.description}`, `${status}: ${step.label}`).not.toMatch(/onayladık|reddettik|kararımız|sonucu belirle/i);
    }
  });

  it("the date is given in Istanbul time", () => {
    expect(istanbulDate("2026-10-13T21:30:00Z")).toBe("14.10.2026");
    expect(istanbulDate("geçersiz")).toBe("");
  });
});

const slotState = (overrides: Partial<DocumentSlotState> = {}): DocumentSlotState => ({
  requirement: "required",
  outOfScope: false,
  reuploadAllowed: false,
  reviewStatus: "pending",
  maxFiles: 10,
  fileCount: 1,
  ...overrides,
});

describe("map link of the appointment location", () => {
  it("only the https link the consultant entered is used; otherwise the button is hidden", () => {
    expect(appointmentMapsLink("https://maps.app.goo.gl/ornek")).toBe("https://maps.app.goo.gl/ornek");
    expect(appointmentMapsLink("  https://maps.app.goo.gl/ornek  ")).toBe("https://maps.app.goo.gl/ornek");
    expect(appointmentMapsLink(null)).toBeNull();
    expect(appointmentMapsLink("")).toBeNull();
    expect(appointmentMapsLink("javascript:alert(1)")).toBeNull();
    expect(appointmentMapsLink("http://ornek.com")).toBeNull();
  });
});

describe("application status — what you need to do", () => {
  const none: CustomerTodoInput = { paymentStatus: "verified", formLocked: true, appointmentStatus: "preferences_submitted", slots: [], tasks: [] };

  it("the list is empty if nothing is required", () => {
    expect(buildCustomerTodos(none)).toEqual([]);
  });

  it("a payment item appears if the payment is pending or could not be verified; not once reported or verified", () => {
    expect(isPaymentDue("awaiting_payment")).toBe(true);
    expect(isPaymentDue("rejected")).toBe(true);
    expect(isPaymentDue("under_review")).toBe(false);
    expect(isPaymentDue("verified")).toBe(false);
    expect(isPaymentDue("not_due")).toBe(false);
    expect(buildCustomerTodos({ ...none, paymentStatus: "rejected" })).toEqual([{ kind: "payment" }]);
  });

  it("items in order: payment, documents, form, appointment preference, open tasks", () => {
    const todos = buildCustomerTodos({
      paymentStatus: "awaiting_payment",
      formLocked: false,
      appointmentStatus: "preferences_requested",
      slots: [
        { id: "s1", label: "Örnek belge 1", reviewNote: "  Okunaklı değil.  ", state: slotState({ reviewStatus: "needs_correction" }) },
        { id: "s2", label: "Örnek belge 2", reviewNote: null, state: slotState({ reviewStatus: "missing", fileCount: 0 }) },
        { id: "s3", label: "Örnek belge 3", reviewNote: "eski not", state: slotState({ reuploadAllowed: true, fileCount: 0 }) },
        { id: "s4", label: "Örnek belge 4", reviewNote: null, state: slotState({ reviewStatus: "approved" }) },
        { id: "s5", label: "Örnek belge 5", reviewNote: "x", state: slotState({ reviewStatus: "needs_correction", outOfScope: true }) },
      ],
      tasks: [
        { id: "t1", title: "Açık görev", description: "Açıklama", status: "open" },
        { id: "t2", title: "Biten görev", description: "", status: "completed" },
      ],
    });
    expect(todos.map((t) => t.kind)).toEqual(["payment", "document", "document", "document", "form", "appointment", "task"]);
    expect(todos[1]).toEqual({ kind: "document", slotId: "s1", label: "Örnek belge 1", reason: "needs_correction", note: "Okunaklı değil." });
    expect(todos[2]).toMatchObject({ slotId: "s2", reason: "missing", note: null });
    // For a document awaiting a re-upload the old review note is not shown.
    expect(todos[3]).toMatchObject({ slotId: "s3", reason: "awaiting_upload", note: null });
    expect(todos[6]).toEqual({ kind: "task", id: "t1", title: "Açık görev", description: "Açıklama" });
  });

  it("extra documents info: was it requested and is it still pending", () => {
    expect(extraDocumentsFrom([])).toEqual({ requested: false, outstanding: false, outstandingCount: 0 });
    expect(extraDocumentsFrom([{ ...slotState(), requestedByStaff: true }])).toEqual({ requested: true, outstanding: false, outstandingCount: 0 });
    expect(extraDocumentsFrom([{ ...slotState({ reviewStatus: "needs_correction" }), requestedByStaff: false }])).toEqual({ requested: true, outstanding: true, outstandingCount: 1 });
  });
});

describe("customer panel — notifications", () => {
  it("the icon is chosen by notification type", () => {
    expect(notificationIcon("appointment.scheduled")).toBe("appointment");
    expect(notificationIcon("payment.reviewed")).toBe("payment");
    expect(notificationIcon("document.requested")).toBe("document");
    for (const kind of ["message.new", "application.status", "application.visa_outcome", "task.new", "form.unlocked"]) expect(notificationIcon(kind), kind).toBe("general");
  });

  it("the time is written relative to how long ago it was (Istanbul time)", () => {
    const now = new Date("2026-10-14T12:00:00Z"); // Istanbul 15:00
    expect(formatNotificationTime("2026-10-14T11:59:40Z", now)).toBe("Az önce");
    expect(formatNotificationTime("2026-10-14T11:48:00Z", now)).toBe("12 dakika önce");
    expect(formatNotificationTime("2026-10-14T10:00:00Z", now)).toBe("2 saat önce");
    expect(formatNotificationTime("2026-10-14T05:40:00Z", now)).toBe("Bugün 08:40");
    expect(formatNotificationTime("2026-10-13T15:05:00Z", now)).toBe("Dün 18:05");
    expect(formatNotificationTime("2026-10-10T09:00:00Z", now)).toBe("10.10.2026");
    expect(formatNotificationTime("geçersiz", now)).toBe("");
  });
});

describe("past applications", () => {
  const now = new Date("2026-10-15T12:00:00Z");

  it("a concluded or cancelled application moves to past applications after about two weeks", () => {
    expect(ARCHIVE_AFTER_DAYS).toBe(14);
    expect(isArchived("result_communicated", "2026-09-30T12:00:00Z", now)).toBe(true);
    expect(isArchived("cancelled", "2026-10-01T12:00:00Z", now)).toBe(true);
    // 13 days: still on the navy card.
    expect(isArchived("result_communicated", "2026-10-02T12:00:01Z", now)).toBe(false);
    // An ongoing application is never moved, no matter how old.
    expect(isArchived("awaiting_result", "2026-01-01T00:00:00Z", now)).toBe(false);
    expect(isArchived("result_communicated", null, now)).toBe(false);
  });

  it("the end moment comes from the last transition in the status history, otherwise from the fallback date", () => {
    const history = [
      { status: "submitted", changedAt: "2026-09-01T10:00:00Z" },
      { status: "result_communicated", changedAt: "2026-09-20T10:00:00Z" },
      { status: "awaiting_result", changedAt: "2026-09-21T10:00:00Z" },
      { status: "result_communicated", changedAt: "2026-09-25T10:00:00Z" },
    ];
    expect(finishedAt("result_communicated", history, "2026-10-10T00:00:00Z")).toBe("2026-09-25T10:00:00Z");
    expect(finishedAt("cancelled", [], "2026-10-10T00:00:00Z")).toBe("2026-10-10T00:00:00Z");
    expect(finishedAt("in_review", history, "2026-10-10T00:00:00Z")).toBeNull();
  });
});

describe("appointment card on the home page", () => {
  const appointment = { status: "documents_complete" as const, appointmentStatus: "scheduled" as const, appointmentAt: "2026-11-19T06:30:00Z" };

  it("visible until the appointment day has passed (including the appointment day, Istanbul time)", () => {
    expect(showUpcomingAppointment(appointment, new Date("2026-11-10T09:00:00Z"))).toBe(true);
    expect(showUpcomingAppointment(appointment, new Date("2026-11-19T15:00:00Z"))).toBe(true);
    // 20 November 00:30 Istanbul time: the day has passed.
    expect(showUpcomingAppointment(appointment, new Date("2026-11-19T21:30:00Z"))).toBe(false);
  });

  it("hidden once the application is concluded, while the result is awaited, when cancelled, and if no appointment was sent", () => {
    const before = new Date("2026-11-10T09:00:00Z");
    expect(showUpcomingAppointment({ ...appointment, status: "result_communicated" }, before)).toBe(false);
    expect(showUpcomingAppointment({ ...appointment, status: "awaiting_result" }, before)).toBe(false);
    expect(showUpcomingAppointment({ ...appointment, status: "cancelled" }, before)).toBe(false);
    expect(showUpcomingAppointment({ ...appointment, appointmentStatus: "completed" }, before)).toBe(false);
    expect(showUpcomingAppointment({ ...appointment, appointmentStatus: "preferences_submitted" }, before)).toBe(false);
  });
});
