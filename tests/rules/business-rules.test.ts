import { describe, expect, it } from "vitest";
import {
  canCustomerDeclarePayment,
  canStaffReviewPayment,
  canStaffSetVisaOutcome,
  checkSubmission,
  type SubmissionInput,
} from "@/features/applications/submission";
import { DEFAULT_APPOINTMENT_CONFIG, mergeSameDayPreferences, parseAppointmentConfig, selectableDates, validatePreferences } from "@/features/appointments/window";
import { checkDeclaredUpload, checkUploadedContent, detectFileType, mimeFromFileName } from "@/features/documents/file-validation";
import {
  blocksSubmission,
  canCustomerDeleteFile,
  canCustomerUpload,
  customerDocumentAlert,
  documentCompletion,
  documentProgress,
  needsCustomerAction,
  type DocumentSlotState,
} from "@/features/documents/rules";
import { cityOptionLabel, surchargeText } from "@/features/pricing/surcharge";
import {
  APPLICATION_STATUSES,
  APPLICATION_TYPE_LABELS,
  APPLICATION_TYPES,
  APPLICATION_TYPES_BY_LABEL,
  CURRENCIES,
  CURRENCIES_BY_LABEL,
  CURRENCY_LABELS,
  DOCUMENT_REQUIREMENT_LABELS,
  DOCUMENT_REQUIREMENTS,
  DOCUMENT_REVIEW_STATUS_LABELS,
  DOCUMENT_REVIEW_STATUSES,
  SPONSOR_STATUS_LABELS,
  SPONSOR_STATUSES,
} from "@/lib/domain/constants";
import { safeInternalPath } from "@/lib/site";
import { addDaysIso, formatDateLongTr, formatMoneyTr, isValidIsoDate, parseMoney, todayInIstanbul } from "@/lib/validation/formats";
import { isValidNationalId } from "@/lib/validation/national-id";
import { minimalSampleForm, TEST_NATIONAL_ID, TEST_TODAY } from "../fixtures/sample-form";

const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const EXE = Uint8Array.from([0x4d, 0x5a, 0x90, 0x00]);
const HTML = new TextEncoder().encode("<html><script>alert(1)</script></html>");
const MB = 1024 * 1024;

describe("file validation", () => {
  it("accepts only PDF, JPG/JPEG and PNG extensions", () => {
    expect(mimeFromFileName("pasaport.PDF")).toBe("application/pdf");
    expect(mimeFromFileName("kimlik.jpeg")).toBe("image/jpeg");
    expect(mimeFromFileName("kimlik.JPG")).toBe("image/jpeg");
    expect(mimeFromFileName("ekran.png")).toBe("image/png");
    for (const name of ["foto.heic", "belge.docx", "virus.exe", "sayfa.html", "resim.svg", "arsiv.zip", "uzantisiz", "cift.pdf.exe", ".pdf.js"]) {
      expect(mimeFromFileName(name), name).toBeNull();
    }
  });

  it("checks the reported type, extension and size before upload", () => {
    expect(checkDeclaredUpload({ name: "a.pdf", mimeType: "application/pdf", sizeBytes: 1000 }, 10 * MB)).toEqual({ ok: true, mimeType: "application/pdf" });
    expect(checkDeclaredUpload({ name: "a.pdf", mimeType: "", sizeBytes: 1000 }, 10 * MB).ok).toBe(true);
    expect(checkDeclaredUpload({ name: "a.pdf", mimeType: "image/png", sizeBytes: 1000 }, 10 * MB).ok).toBe(false);
    expect(checkDeclaredUpload({ name: "a.exe", mimeType: "application/pdf", sizeBytes: 1000 }, 10 * MB).ok).toBe(false);
    expect(checkDeclaredUpload({ name: "a.pdf", mimeType: "application/pdf", sizeBytes: 0 }, 10 * MB).ok).toBe(false);
    expect(checkDeclaredUpload({ name: "a.pdf", mimeType: "application/pdf", sizeBytes: Number.NaN }, 10 * MB).ok).toBe(false);
    const tooLarge = checkDeclaredUpload({ name: "a.pdf", mimeType: "application/pdf", sizeBytes: 11 * MB }, 10 * MB);
    expect(tooLarge).toMatchObject({ ok: false });
    if (!tooLarge.ok) expect(tooLarge.message).toContain("10 MB");
  });

  it("determines the real file type from the content (signature bytes)", () => {
    expect(detectFileType(PDF)).toBe("application/pdf");
    expect(detectFileType(JPEG)).toBe("image/jpeg");
    expect(detectFileType(PNG)).toBe("image/png");
    expect(detectFileType(EXE)).toBeNull();
    expect(detectFileType(HTML)).toBeNull();
    expect(detectFileType(new Uint8Array(0))).toBeNull();
  });

  it("rejects a file with a changed extension by looking at its content", () => {
    expect(checkUploadedContent(EXE, "application/pdf", 10 * MB).ok).toBe(false);
    expect(checkUploadedContent(HTML, "image/png", 10 * MB).ok).toBe(false);
    expect(checkUploadedContent(PNG, "application/pdf", 10 * MB).ok).toBe(false);
    expect(checkUploadedContent(PDF, "application/pdf", 10 * MB)).toEqual({ ok: true, mimeType: "application/pdf" });
    expect(checkUploadedContent(new Uint8Array(0), "application/pdf", 10 * MB).ok).toBe(false);
  });

  it("rejects it if the real size that reached the server exceeds the limit (does not trust the reported size)", () => {
    const big = new Uint8Array(2 * MB);
    big.set(PDF);
    expect(checkUploadedContent(big, "application/pdf", 1 * MB).ok).toBe(false);
  });
});

const slot = (overrides: Partial<DocumentSlotState> = {}): DocumentSlotState => ({
  requirement: "required",
  outOfScope: false,
  reuploadAllowed: false,
  reviewStatus: "pending",
  maxFiles: 10,
  fileCount: 0,
  ...overrides,
});

describe("document rules", () => {
  it("blocks submission until a required document is uploaded", () => {
    expect(blocksSubmission(slot())).toBe(true);
    expect(blocksSubmission(slot({ fileCount: 1 }))).toBe(false);
    expect(documentCompletion(slot())).toBe("missing");
    expect(documentCompletion(slot({ requirement: "optional" }))).toBe("optional_empty");
  });

  it("the progress counter only counts required documents; not optional ones or those not belonging to the type", () => {
    const slots = [
      slot({ fileCount: 1 }), // required, uploaded
      slot(), // required, pending
      slot({ requirement: "optional" }), // not counted
      slot({ requirement: "optional", fileCount: 1 }), // not counted
      slot({ outOfScope: true, fileCount: 1 }), // not counted
    ];
    expect(documentProgress(slots)).toEqual({ done: 1, total: 2 });
    // The remaining count equals the "pending" count.
    expect(slots.filter(blocksSubmission).length).toBe(2 - 1);
    expect(documentProgress([])).toEqual({ done: 0, total: 0 });
  });

  it("optional and out-of-scope documents do not block submission", () => {
    expect(blocksSubmission(slot({ requirement: "optional" }))).toBe(false);
    expect(blocksSubmission(slot({ outOfScope: true }))).toBe(false);
  });

  it("after submission the customer can only change a document the consultant reopened", () => {
    expect(canCustomerUpload("draft", slot()).ok).toBe(true);
    expect(canCustomerUpload("in_review", slot()).ok).toBe(false);
    expect(canCustomerDeleteFile("submitted", slot({ fileCount: 1 })).ok).toBe(false);
    expect(canCustomerUpload("awaiting_customer", slot({ reuploadAllowed: true, reviewStatus: "needs_correction" })).ok).toBe(true);
    expect(canCustomerDeleteFile("awaiting_customer", slot({ reuploadAllowed: true, fileCount: 1 })).ok).toBe(true);
    expect(canCustomerUpload("cancelled", slot({ reuploadAllowed: true })).ok).toBe(false);
  });

  it("applies the file count limit and out-of-scope slots", () => {
    expect(canCustomerUpload("draft", slot({ fileCount: 10, maxFiles: 10 })).ok).toBe(false);
    expect(canCustomerUpload("draft", slot({ outOfScope: true })).ok).toBe(false);
  });

  it("determines documents waiting for action from the customer", () => {
    expect(needsCustomerAction(slot({ reviewStatus: "needs_correction", fileCount: 1 }))).toBe(true);
    expect(needsCustomerAction(slot({ reviewStatus: "missing" }))).toBe(true);
    expect(needsCustomerAction(slot({ reuploadAllowed: true }))).toBe(true);
    expect(needsCustomerAction(slot({ reviewStatus: "approved", fileCount: 1 }))).toBe(false);
    expect(needsCustomerAction(slot({ fileCount: 1 }))).toBe(false);
  });

  it("the red document warning on Documents: correction, missing and newly requested documents; disappears after upload", () => {
    expect(customerDocumentAlert("awaiting_customer", slot({ reviewStatus: "needs_correction", fileCount: 1 }), "Sayfa kesik")).toEqual({
      title: "Bu belgede düzeltme gerekiyor",
      note: "Sayfa kesik",
    });
    expect(customerDocumentAlert("awaiting_customer", slot({ reviewStatus: "missing" }), "Eksik sayfa")).toEqual({ title: "Bu belge eksik", note: "Eksik sayfa" });
    // A document newly requested by the consultant (no note, no file).
    expect(customerDocumentAlert("awaiting_customer", slot({ reviewStatus: "missing", reuploadAllowed: true }), null)).toEqual({
      title: "Danışmanınız bu belgeyi istiyor",
      note: null,
    });
    expect(customerDocumentAlert("awaiting_customer", slot({ reuploadAllowed: true, fileCount: 1 }), null)).toBeNull();
    expect(customerDocumentAlert("draft", slot({ reviewStatus: "missing" }), "x")).toBeNull();
    expect(customerDocumentAlert("cancelled", slot({ reviewStatus: "missing" }), "x")).toBeNull();
  });
});

describe("randevu tercihi penceresi", () => {
  const config = DEFAULT_APPOINTMENT_CONFIG;

  it("the default window starts tomorrow and offers 10 selectable days", () => {
    const dates = selectableDates("2026-10-13", config);
    expect(dates).toHaveLength(10);
    expect(dates[0]).toBe("2026-10-14");
    expect(dates[9]).toBe("2026-10-23");
  });

  it("crosses month and year boundaries correctly", () => {
    expect(selectableDates("2026-12-28", config).slice(-1)).toEqual(["2027-01-07"]);
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("weekends and excluded dates are not counted; the window extends instead (10 working days)", () => {
    // 2026-10-13 is a Tuesday. Weekends closed: 10 working days from Wednesday 14 October to Tuesday 27 October.
    const weekdays = selectableDates("2026-10-13", { ...config, includeWeekends: false });
    expect(weekdays).not.toContain("2026-10-17");
    expect(weekdays).not.toContain("2026-10-18");
    expect(weekdays).toHaveLength(10);
    expect(weekdays.at(-1)).toBe("2026-10-27");
    // today is Friday 23 October, first day Monday 26 October → last day Friday 6 November.
    const ownerExample = selectableDates("2026-10-23", { ...config, startOffsetDays: 3, includeWeekends: false });
    expect([ownerExample[0], ownerExample.at(-1), ownerExample.length]).toEqual(["2026-10-26", "2026-11-06", 10]);
    const withHoliday = selectableDates("2026-10-13", { ...config, excludedDates: ["2026-10-20"] });
    expect(withHoliday).not.toContain("2026-10-20");
    expect(withHoliday).toHaveLength(10);
    expect(withHoliday.at(-1)).toBe("2026-10-24");
  });

  it("invalid values in the settings fall back to safe defaults", () => {
    expect(parseAppointmentConfig({})).toEqual(config);
    expect(
      parseAppointmentConfig({
        "appointment.window_days": 9999,
        "appointment.start_offset_days": -5,
        "appointment.include_weekends": "evet",
        "appointment.excluded_dates": ["2026-10-29", "bozuk", 5],
      }),
    ).toEqual({ windowDays: 60, startOffsetDays: 0, includeWeekends: true, excludedDates: ["2026-10-29"] });
  });

  it("requires 1–3 different days from the calendar; all day, morning or afternoon for each", () => {
    // A single preference is enough.
    expect(validatePreferences([{ date: "2026-10-14", slot: "morning" }], "2026-10-13", config).ok).toBe(true);
    expect(
      validatePreferences(
        [
          { date: "2026-10-14", slot: "morning" },
          { date: "2026-10-15", slot: "morning" },
          { date: "2026-10-16", slot: "morning" },
          { date: "2026-10-19", slot: "morning" },
        ],
        "2026-10-13",
        config,
      ).ok,
    ).toBe(false);
    const ok = validatePreferences(
      [
        { date: "2026-10-14", slot: "full_day" },
        { date: "2026-10-15", slot: "evening" },
        { date: "2026-10-16", slot: "morning" },
      ],
      "2026-10-13",
      config,
    );
    expect(ok.ok).toBe(true);
    // The same day cannot be picked twice (even with a different time slot).
    const sameDay = validatePreferences(
      [
        { date: "2026-10-14", slot: "morning" },
        { date: "2026-10-14", slot: "evening" },
        { date: "2026-10-15", slot: "morning" },
      ],
      "2026-10-13",
      config,
    );
    expect(sameDay).toMatchObject({ ok: false, message: expect.stringMatching(/Aynı günü/) });
  });

  it("two time slots of the same day in an old record are shown as 'Tüm gün' in the calendar", () => {
    expect(
      mergeSameDayPreferences([
        { date: "2026-10-14", slot: "morning" },
        { date: "2026-10-14", slot: "evening" },
        { date: "2026-10-15", slot: "morning" },
      ]),
    ).toEqual([
      { date: "2026-10-14", slot: "full_day" },
      { date: "2026-10-15", slot: "morning" },
    ]);
  });

  it("rejects missing, duplicate, out-of-range or malformed preferences", () => {
    const check = (input: unknown) => validatePreferences(input, "2026-10-13", config).ok;
    expect(check([])).toBe(false);
    expect(check("x")).toBe(false);
    expect(
      check([
        { date: "2026-10-14", slot: "morning" },
        { date: "2026-10-14", slot: "morning" },
        { date: "2026-10-15", slot: "morning" },
      ]),
    ).toBe(false);
    // Today and the day after the window cannot be picked.
    expect(
      check([
        { date: "2026-10-13", slot: "morning" },
        { date: "2026-10-14", slot: "evening" },
        { date: "2026-10-15", slot: "morning" },
      ]),
    ).toBe(false);
    expect(
      check([
        { date: "2026-10-24", slot: "morning" },
        { date: "2026-10-14", slot: "evening" },
        { date: "2026-10-15", slot: "morning" },
      ]),
    ).toBe(false);
    expect(
      check([
        { date: "2026-10-14", slot: "noon" },
        { date: "2026-10-14", slot: "evening" },
        { date: "2026-10-15", slot: "morning" },
      ]),
    ).toBe(false);
    expect(check([null, 1, {}])).toBe(false);
  });
});

describe("appointment city surcharge", () => {
  it("shown in the list with its amount if there is a surcharge, otherwise only the city name", () => {
    expect(surchargeText(1250.5, "TRY")).toBe("1.250,5 TL");
    expect(surchargeText(200, "GBP")).toBe("200 GBP");
    expect(surchargeText(0, "TRY")).toBeNull();
    expect(surchargeText(Number.NaN, "TRY")).toBeNull();
    expect(cityOptionLabel("Ankara", 500, "TRY")).toBe("Ankara (+500 TL ek ücret)");
    expect(cityOptionLabel("İzmir", 0, "EUR")).toBe("İzmir");
  });
});

describe("application submission check", () => {
  const preferences = [
    { date: "2026-10-14", slot: "morning" },
    { date: "2026-10-15", slot: "full_day" },
    { date: "2026-10-16", slot: "evening" },
  ];
  const base: SubmissionInput = {
    status: "draft",
    applicationTypes: ["general_employee"],
    sponsorStatus: null,
    cityId: null,
    activeCityIds: [],
    formData: minimalSampleForm,
    documents: [{ ...slot({ fileCount: 1 }), label: "Geçerli pasaport" }],
    preferences,
    today: TEST_TODAY,
    appointmentConfig: DEFAULT_APPOINTMENT_CONFIG,
  };

  it("no blocker when everything is complete", () => {
    expect(checkSubmission(base)).toEqual([]);
  });

  it("blocks submission if a required document is missing", () => {
    const issues = checkSubmission({ ...base, documents: [{ ...slot(), label: "Geçerli pasaport" }] });
    expect(issues).toEqual([{ step: "documents", message: "“Geçerli pasaport” belgesi yüklenmedi." }]);
  });

  it("reports a missing application type and sponsor status", () => {
    expect(checkSubmission({ ...base, applicationTypes: [] }).map((i) => i.step)).toContain("type");
    expect(checkSubmission({ ...base, applicationTypes: ["uydurma"] }).map((i) => i.step)).toContain("type");
    expect(checkSubmission({ ...base, applicationTypes: ["student", "sponsored"] })[0]!.message).toMatch(/Sponsor/);
    expect(checkSubmission({ ...base, applicationTypes: ["student", "sponsored"], sponsorStatus: "retired" })).toEqual([]);
  });

  it("if the company defined cities, the appointment city is asked in the appointment step", () => {
    expect(checkSubmission({ ...base, activeCityIds: ["c1"] })).toEqual([{ step: "appointment", message: "Randevu şehrini seçmelisiniz." }]);
    // If a city that is no longer active is still selected, a new choice is required.
    expect(checkSubmission({ ...base, activeCityIds: ["c1"], cityId: "oldest" }).map((i) => i.step)).toEqual(["appointment"]);
    expect(checkSubmission({ ...base, activeCityIds: ["c1"], cityId: "c1" })).toEqual([]);
    // If no cities are defined the city is not asked.
    expect(checkSubmission({ ...base, activeCityIds: [], cityId: null })).toEqual([]);
  });

  it("points to the section if the form is incomplete", () => {
    const issues = checkSubmission({ ...base, formData: { ...minimalSampleForm, passport: {} } });
    expect(issues).toEqual([expect.objectContaining({ step: "form", sectionId: "passport" })]);
  });

  it("blocks if the appointment preference is missing or its dates are outdated", () => {
    expect(checkSubmission({ ...base, preferences: [] }).map((i) => i.step)).toEqual(["appointment"]);
    // A single preference is enough.
    expect(checkSubmission({ ...base, preferences: preferences.slice(0, 1) })).toEqual([]);
    // The customer saved preferences days ago; they are now outside the window.
    expect(checkSubmission({ ...base, today: "2026-11-20" }).map((i) => i.step)).toContain("appointment");
  });

  it("an application that is not a draft cannot be submitted again", () => {
    expect(checkSubmission({ ...base, status: "submitted" })).toHaveLength(1);
  });
});

describe("payment and visa outcome rules", () => {
  it("the visa outcome is recorded after documents are complete and the payment is verified; a refusal reason is required", () => {
    const allowed = ["documents_complete", "awaiting_result", "result_communicated"] as const;
    for (const status of allowed) {
      expect(canStaffSetVisaOutcome(status, "verified", "approved", "").ok, status).toBe(true);
    }
    for (const status of APPLICATION_STATUSES.filter((s) => !(allowed as readonly string[]).includes(s))) {
      expect(canStaffSetVisaOutcome(status, "verified", "approved", "").ok, status).toBe(false);
    }
    expect(canStaffSetVisaOutcome("awaiting_result", "under_review", "approved", "").ok).toBe(false);
    expect(canStaffSetVisaOutcome("awaiting_result", "verified", "refused", "   ").ok).toBe(false);
    expect(canStaffSetVisaOutcome("awaiting_result", "verified", "refused", "Seyahat amacı açıklanmadı.").ok).toBe(true);
    expect(canStaffSetVisaOutcome("awaiting_result", "verified", "approved", "x".repeat(2001)).ok).toBe(false);
  });

  it("the customer can only report a payment while it is pending or refused", () => {
    expect(canCustomerDeclarePayment("awaiting_payment").ok).toBe(true);
    expect(canCustomerDeclarePayment("rejected").ok).toBe(true);
    expect(canCustomerDeclarePayment("under_review").ok).toBe(false);
    expect(canCustomerDeclarePayment("verified").ok).toBe(false);
    expect(canCustomerDeclarePayment("not_due").ok).toBe(false);
  });

  it("staff cannot review a payment on a draft; an explanation is required when refusing", () => {
    expect(canStaffReviewPayment("draft", "not_due", "verify", "").ok).toBe(false);
    expect(canStaffReviewPayment("submitted", "under_review", "verify", "").ok).toBe(true);
    expect(canStaffReviewPayment("submitted", "awaiting_payment", "verify", "").ok).toBe(true);
    expect(canStaffReviewPayment("submitted", "verified", "verify", "").ok).toBe(false);
    expect(canStaffReviewPayment("submitted", "under_review", "reject", "  ").ok).toBe(false);
    expect(canStaffReviewPayment("submitted", "under_review", "reject", "Hesapta görünmüyor").ok).toBe(true);
    // A verified payment moves the application to review; verification cannot be undone after that.
    expect(canStaffReviewPayment("in_review", "verified", "reject", "Yanlışlıkla doğrulandı").ok).toBe(false);
    expect(canStaffReviewPayment("awaiting_customer", "verified", "reject", "Yanlışlıkla doğrulandı").ok).toBe(false);
  });
});

describe("order of select lists", () => {
  const collator = new Intl.Collator("tr");
  const labelsOf = <T extends string>(values: readonly T[], labels: Record<T, string>) => values.map((v) => labels[v]);
  const sorted = (labels: string[]) => [...labels].sort(collator.compare);

  it("application type, sponsor status, document rule and document review status are alphabetical by label", () => {
    const lists = [
      labelsOf(APPLICATION_TYPES_BY_LABEL, APPLICATION_TYPE_LABELS),
      labelsOf(SPONSOR_STATUSES, SPONSOR_STATUS_LABELS),
      labelsOf(DOCUMENT_REQUIREMENTS, DOCUMENT_REQUIREMENT_LABELS),
      labelsOf(DOCUMENT_REVIEW_STATUSES, DOCUMENT_REVIEW_STATUS_LABELS),
      labelsOf(CURRENCIES_BY_LABEL, CURRENCY_LABELS),
    ];
    for (const labels of lists) expect(labels).toEqual(sorted(labels));
    expect(lists[0]).toEqual(["Emekli", "Genel (Çalışan)", "İngiltere Akraba Ziyareti", "Öğrenci", "Self Employed (Kendi İşinin Sahibi)", "Sponsorlu Başvuru"]);
    expect(lists[2]).toEqual(["İsteğe bağlı", "Zorunlu"]);
  });

  it("the alphabetical application type and currency lists contain every value", () => {
    expect([...APPLICATION_TYPES_BY_LABEL].sort()).toEqual([...APPLICATION_TYPES].sort());
    expect([...CURRENCIES_BY_LABEL].sort()).toEqual([...CURRENCIES].sort());
  });
});

describe("helpers", () => {
  it("national ID number algorithm", () => {
    expect(isValidNationalId(TEST_NATIONAL_ID)).toBe(true);
    expect(isValidNationalId("10000000147")).toBe(false);
    expect(isValidNationalId("01234567890")).toBe(false);
    expect(isValidNationalId("1000000014")).toBe(false);
    expect(isValidNationalId("1000000014a")).toBe(false);
  });

  it("date and amount formats", () => {
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2025-02-29")).toBe(false);
    expect(isValidIsoDate("2025-13-01")).toBe(false);
    expect(formatDateLongTr("2026-10-13")).toBe("13 Ekim 2026 Salı");
    expect(parseMoney("45.000")).toBe("45000");
    expect(parseMoney("45.000,5")).toBe("45000.5");
    expect(parseMoney("1.234.567,89 TL")).toBe("1234567.89");
    expect(parseMoney("12,345,678")).toBeNull();
    expect(parseMoney("-5")).toBeNull();
    expect(formatMoneyTr("45000.5")).toBe("45.000,5");
  });

  it("computes the Istanbul date correctly around UTC midnight", () => {
    // 21:30 UTC = 00:30 the next day in Istanbul
    expect(todayInIstanbul(new Date("2026-10-13T21:30:00Z"))).toBe("2026-10-14");
    expect(todayInIstanbul(new Date("2026-10-13T20:59:00Z"))).toBe("2026-10-13");
  });

  it("a redirect target can only be a known in-app path (open redirect protection)", () => {
    expect(safeInternalPath("/panel/applications/1", "/x")).toBe("/panel/applications/1");
    expect(safeInternalPath("/admin?page=2", "/x")).toBe("/admin?page=2");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "/panelx", "javascript:alert(1)", "/sign-in", "", null, 5, "/panel\n/x"]) {
      expect(safeInternalPath(bad, "/guvenli"), String(bad)).toBe("/guvenli");
    }
  });
});
