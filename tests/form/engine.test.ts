import { describe, expect, it } from "vitest";
import { COUNTRY_SELECT_OPTIONS, FORM_SECTIONS, getSection, VISIT_COUNT_OPTIONS } from "@/features/application-form/definition";
import {
  buildFormData,
  buildSectionDisplay,
  countRequiredFields,
  dateLimits,
  ensureRepeatMinimums,
  formHasAnyAnswer,
  normalizeSectionData,
  pruneFormData,
  repeatLimits,
  setAtPath,
  trimRepeatMaximums,
  validateForm,
  validateSection,
} from "@/features/application-form/engine";
import { FIELD_HELP, getFieldHelp, helpKeyFor } from "@/features/application-form/help";
import type { DateField, Field, FormData, MonthField, RepeatField } from "@/features/application-form/types";
import { maskDateTyping, maskTimeTyping, parseDateInput, parseTimeInput } from "@/lib/validation/formats";
import { COUNTRIES, COUNTRY_OPTIONS, countryName } from "@/lib/domain/countries";
import { fullSampleForm, minimalSampleForm, TEST_TODAY, TEST_NATIONAL_ID } from "../fixtures/sample-form";

const section = (id: Parameters<typeof getSection>[0]) => getSection(id);

describe("form definition", () => {
  it("contains the nine sections from the requirements in order", () => {
    expect(FORM_SECTIONS.map((s) => s.id)).toEqual(["personal", "contact", "passport", "employment", "travel", "family", "history", "security", "additional"]);
  });

  it("field keys are unique in every scope", () => {
    const check = (fields: readonly Field[], where: string) => {
      const keys = fields.map((f) => f.key);
      expect(new Set(keys).size, where).toBe(keys.length);
      for (const field of fields) {
        if (field.type === "group" || field.type === "repeat") check(field.fields, `${where}.${field.key}`);
      }
    };
    for (const s of FORM_SECTIONS) check(s.fields, s.id);
  });

  it("contains the option lists listed in the requirements", () => {
    const options = (sectionId: Parameters<typeof getSection>[0], key: string) => {
      const field = section(sectionId).fields.find((f) => f.key === key);
      return field && field.type === "select" ? field.options.map((o) => o.label) : [];
    };
    expect(options("personal", "gender")).toEqual(["Erkek", "Kadın"]);
    expect(options("personal", "maritalStatus")).toEqual(["Bekar", "Boşanmış", "Dul", "Evli"]);
    expect(options("contact", "homeOwnership")).toEqual(["Ailemle yaşamaktayım", "Bana ait", "Kira"]);
    expect(options("travel", "purpose")).toEqual(["Aile Ziyareti", "Eğitim", "Ticari", "Turistik", "Diğer"]);
    expect(options("travel", "accommodationType")).toEqual(["Biriyle kalacağım", "Otelde kalacağım", "Diğer"]);
    // Lists with a numeric meaning are not sorted alphabetically.
    expect(options("history", "ukVisitCount")).toEqual(["Hiç", "Bir defa", "2-5 defa", "6 veya daha fazla"]);
    expect(options("history", "otherCountriesVisitCount")).toEqual(["Hiç", "Bir defa", "2-5 defa", "6 veya daha fazla"]);
  });

  it("select lists are sorted by the Turkish alphabet, except numeric lists and a trailing 'Diğer'", () => {
    const collator = new Intl.Collator("tr");
    const selects: { where: string; labels: string[] }[] = [];
    const collect = (fields: readonly Field[], where: string) => {
      for (const field of fields) {
        if (field.type === "group" || field.type === "repeat") collect(field.fields, `${where}.${field.key}`);
        else if (field.type === "select" && field.options !== VISIT_COUNT_OPTIONS) {
          // In country lists "Türkiye - TUR" is pinned at the top; the order is checked from there on.
          const labels = field.options.map((o) => o.label);
          selects.push({ where: `${where}.${field.key}`, labels: field.options === COUNTRY_SELECT_OPTIONS ? labels.slice(1) : labels });
        }
      }
    };
    for (const s of FORM_SECTIONS) collect(s.fields, s.id);
    expect(selects.length).toBeGreaterThan(10);
    for (const { where, labels } of selects) {
      const sortable = labels.at(-1) === "Diğer" ? labels.slice(0, -1) : labels;
      expect(sortable, where).not.toContain("Diğer");
      expect(sortable, where).toEqual([...sortable].sort(collator.compare));
    }
  });

  it("country and nationality fields use the coded country list", () => {
    expect(COUNTRIES).toHaveLength(250);
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(250);
    expect(new Set(COUNTRIES.map((c) => c.name)).size).toBe(250);
    expect(COUNTRIES.every((c) => /^[A-Z]{3}$/.test(c.code) && c.name.trim() === c.name && c.name.length > 1)).toBe(true);
    expect(COUNTRY_OPTIONS.find((o) => o.value === "TUR")).toEqual({ value: "TUR", label: "Türkiye - TUR" });
    expect(COUNTRY_OPTIONS.find((o) => o.value === "GBR")?.label).toBe("Birleşik Krallık - GBR");
    // Türkiye at the top of every country list, once.
    expect(COUNTRY_SELECT_OPTIONS[0]).toEqual({ value: "TUR", label: "Türkiye - TUR" });
    expect(COUNTRY_SELECT_OPTIONS.filter((o) => o.value === "TUR")).toHaveLength(1);
    expect(COUNTRY_SELECT_OPTIONS).toHaveLength(COUNTRY_OPTIONS.length);
    expect(countryName("DEU")).toBe("Almanya");
    // A value not in the list (old, free text) is returned as is.
    expect(countryName("T.C.")).toBe("T.C.");

    const countryPaths: string[] = [];
    const collect = (fields: readonly Field[], where: string) => {
      for (const field of fields) {
        if (field.type === "group" || field.type === "repeat") collect(field.fields, `${where}.${field.key}`);
        else if (field.type === "select" && field.options === COUNTRY_SELECT_OPTIONS) countryPaths.push(`${where}.${field.key}`);
        // No field asking for a country or nationality may remain free text.
        else if (field.key === "nationality" || field.key === "country") throw new Error(`liste kullanmıyor: ${where}.${field.key}`);
      }
    };
    for (const s of FORM_SECTIONS) collect(s.fields, s.id);
    expect(countryPaths).toEqual([
      "personal.nationality",
      "passport.otherPassport.country",
      "travel.companion.nationality",
      "family.spouse.nationality",
      "family.children.nationality",
      "family.mother.nationality",
      "family.mother.previousNationalities.nationality",
      "family.father.nationality",
      "family.father.previousNationalities.nationality",
      "family.ukRelative.nationality",
      "history.otherCountriesVisits.country",
      "history.elsewhereVisits.country",
    ]);
  });

  it("a country value not in the list is not accepted", () => {
    const data = normalizeSectionData(section("personal"), { nationality: "Türkiye" });
    expect(data.nationality).toBe("");
    expect(normalizeSectionData(section("personal"), { nationality: "TUR" }).nationality).toBe("TUR");
  });

  it("previous addresses accept at most two entries", () => {
    const field = section("contact").fields.find((f) => f.key === "previousAddresses");
    expect(field).toMatchObject({ type: "repeat", max: 2 });
  });

  it("travel history: at most 3 trips for the UK, at most 2 for Australia/Canada/…; no practical limit for other countries", () => {
    const max = (key: string) => {
      const field = section("history").fields.find((f) => f.key === key);
      return field && field.type === "repeat" ? field.max : undefined;
    };
    expect(max("ukVisits")).toBe(3);
    expect(max("otherCountriesVisits")).toBe(2);
    expect(max("elsewhereVisits")).toBeGreaterThanOrEqual(100);
    const history = normalizeSectionData(section("history"), { ukVisits: Array.from({ length: 5 }, () => ({ purpose: "Turistik" })) });
    expect(history.ukVisits).toHaveLength(3);
  });

  it("formda posta kodu sorulmaz", () => {
    const keys: string[] = [];
    const collect = (fields: readonly Field[], where: string) => {
      for (const field of fields) {
        keys.push(`${where}.${field.key}`);
        if (field.type === "group" || field.type === "repeat") collect(field.fields, `${where}.${field.key}`);
      }
    };
    for (const s of FORM_SECTIONS) collect(s.fields, s.id);
    expect(keys.filter((k) => /postcode/i.test(k))).toEqual([]);
  });

  it("the sample data is fully valid against the fixed date used as today", () => {
    expect(validateForm(pruneFormData(fullSampleForm), TEST_TODAY).valid).toBe(true);
    expect(validateForm(pruneFormData(minimalSampleForm), TEST_TODAY).valid).toBe(true);
  });
});

describe("normalization (untrusted data)", () => {
  it("drops unknown keys and reduces types to text", () => {
    const data = normalizeSectionData(section("personal"), {
      firstName: "  Ali   Veli  ",
      lastName: 12345,
      gender: "robot",
      tcNo: " 100 000 001-46 ",
      __proto__: { admin: true },
      role: "staff",
      birthDate: "not-a-date",
      nested: { evil: true },
    });
    expect(data).toEqual({
      firstName: "Ali Veli",
      lastName: "12345",
      maidenName: "",
      gender: "",
      maritalStatus: "",
      nationality: "",
      birthDate: "",
      birthPlace: "",
      tcNo: TEST_NATIONAL_ID,
    });
    expect(Object.keys(data)).not.toContain("role");
  });

  it("stores the national ID number as text; leading zeros are not lost", () => {
    const data = normalizeSectionData(section("personal"), { tcNo: "01234567890" });
    expect(data.tcNo).toBe("01234567890");
    expect(typeof data.tcNo).toBe("string");
  });

  it("converts the passport number to upper case and removes spaces; alphanumeric values are kept", () => {
    const data = normalizeSectionData(section("passport"), { passportNo: " u 0012 345 " });
    expect(data.passportNo).toBe("U0012345");
  });

  it("limits text length and repeat counts", () => {
    const personal = normalizeSectionData(section("personal"), { firstName: "x".repeat(500) });
    expect((personal.firstName as string).length).toBe(60);
    const contact = normalizeSectionData(section("contact"), { previousAddresses: Array.from({ length: 9 }, () => ({ address: "a" })) });
    expect(contact.previousAddresses).toHaveLength(2);
  });

  it("converts the amount to a string with a decimal point", () => {
    const data = normalizeSectionData(section("employment"), { monthlyNetIncome: "45.000,50", monthlyExpenses: "30 000" });
    expect(data.monthlyNetIncome).toBe("45000.50");
    expect(data.monthlyExpenses).toBe("30000");
  });

  it("builds data with every section from the database rows; a broken row does not crash the form", () => {
    const formData = buildFormData([
      { section_id: "personal", data: { firstName: "Ali" } },
      { section_id: "contact", data: "bozuk" },
      { section_id: "bilinmeyen", data: { x: 1 } },
    ]);
    expect(Object.keys(formData).sort()).toEqual(FORM_SECTIONS.map((s) => s.id).sort());
    expect(formData.personal!.firstName).toBe("Ali");
    expect(formData.contact!.homeAddress).toBe("");
  });
});

describe("validation", () => {
  const validate = (sectionId: Parameters<typeof getSection>[0], overrides: Record<string, unknown>, root: FormData = minimalSampleForm) => {
    const data = { ...(minimalSampleForm[sectionId] ?? {}), ...overrides };
    return validateSection(section(sectionId), data, { ...root, [sectionId]: data }, TEST_TODAY);
  };

  it("gives a clear Turkish error when required fields are empty", () => {
    const errors = validateSection(section("personal"), normalizeSectionData(section("personal"), {}), {}, TEST_TODAY);
    expect(errors.firstName).toBe("Bu alan zorunludur.");
    expect(errors.gender).toBe("Lütfen bir seçim yapınız.");
    expect(errors.birthDate).toBe("Lütfen bir tarih giriniz.");
    expect(errors.maidenName).toBeUndefined();
  });

  it("validates the national ID number by its digits and the algorithm", () => {
    expect(validate("personal", { tcNo: "123" }).tcNo).toMatch(/11 rakam/);
    expect(validate("personal", { tcNo: "1234567890a" }).tcNo).toMatch(/11 rakam/);
    expect(validate("personal", { tcNo: "12345678901" }).tcNo).toMatch(/geçersiz/);
    expect(validate("personal", { tcNo: "00000000000" }).tcNo).toMatch(/geçersiz/);
    expect(validate("personal", { tcNo: TEST_NATIONAL_ID }).tcNo).toBeUndefined();
  });

  it("validates date, e-mail, phone and amount formats", () => {
    expect(validate("personal", { birthDate: "2030-01-01" }).birthDate).toMatch(/ileri olamaz/);
    expect(validate("personal", { birthDate: "1990-02-30" }).birthDate).toMatch(/Geçerli bir tarih/);
    expect(validate("contact", { email: "ali@" }).email).toMatch(/e-posta/);
    expect(validate("contact", { mobilePhone: "12" }).mobilePhone).toMatch(/telefon/);
    expect(validate("contact", { mobilePhone: "+90 532 000 00 00" }).mobilePhone).toBeUndefined();
    expect(validate("employment", { monthlyNetIncome: "çok" }).monthlyNetIncome).toMatch(/tutar/);
    expect(validate("employment", { monthlyNetIncome: "0" }).monthlyNetIncome).toBeUndefined();
  });

  it("compares dates that depend on each other", () => {
    const other = validate("passport", { hasOtherPassport: "yes", otherPassport: { issueDate: "2022-01-01", expiryDate: "2021-01-01" } });
    expect(other["otherPassport.expiryDate"]).toMatch(/sonra olmalıdır/);
    expect(validate("travel", { departureDate: "2026-12-10", returnDate: "2026-12-01" }).returnDate).toMatch(/önce olamaz/);
    // Returning on the same day is accepted.
    expect(validate("travel", { departureDate: "2026-12-10", returnDate: "2026-12-10" }).returnDate).toBeUndefined();
    expect(validate("travel", { departureDate: "2026-01-01" }).departureDate).toMatch(/geçmişte olamaz/);
  });

  it("an expired passport is not accepted", () => {
    expect(validate("passport", { issueDate: "2015-01-01", expiryDate: "2025-01-01" }).expiryDate).toMatch(/geçerlilik süresi dolmuş/);
    expect(validate("passport", { issueDate: "2020-01-01", expiryDate: "2030-01-01" }).expiryDate).toBeUndefined();
  });

  it("event dates cannot be before the date of birth, and parents cannot be born after the applicant", () => {
    const root: FormData = { personal: { birthDate: "1990-05-05" } };
    expect(validate("passport", { issueDate: "1989-01-01" }, root).issueDate).toMatch(/doğum tarihinizden önce/);
    expect(validate("passport", { issueDate: "1990-05-05" }, root).issueDate).toBeUndefined();
    const family = validate("family", { father: { birthDate: "1995-01-01" }, mother: { birthDate: "1960-01-01" } }, root);
    expect(family["father.birthDate"]).toMatch(/Anne veya babanızın doğum tarihi/);
    expect(family["mother.birthDate"]).toBeUndefined();
    const addresses = validate("contact", { addressChangedLastTwoYears: "yes", previousAddresses: [{ address: "x", startDate: "1989-01", endDate: "1991-01" }] }, root);
    expect(addresses["previousAddresses.0.startDate"]).toMatch(/doğum tarihinizden önce/);
  });

  it("a cross-section date rule is checked at submission regardless of the order the sections were filled in", () => {
    // If the customer enters the parents' details first and their own date of birth later, the error shows in the Family section.
    const parentsFirst: FormData = {
      ...minimalSampleForm,
      family: { ...minimalSampleForm.family, father: { ...(minimalSampleForm.family!.father as object), birthDate: "1995-01-01" } },
      personal: { ...minimalSampleForm.personal, birthDate: "" },
    };
    expect(validateForm(pruneFormData(parentsFirst), TEST_TODAY).sections.family.errorCount).toBe(0);
    const later: FormData = { ...parentsFirst, personal: { ...minimalSampleForm.personal, birthDate: "1990-05-05" } };
    const result = validateForm(pruneFormData(later), TEST_TODAY);
    expect(result.valid).toBe(false);
    expect(result.sections.family.errorCount).toBeGreaterThan(0);
  });

  it("dates asked as 'in the last 10 years' cannot be older", () => {
    expect(validate("history", { hadUkVisaLast10Years: "yes", ukVisaIssueDate: "2016-10-12" }).ukVisaIssueDate).toMatch(/son 10 yıl/);
    expect(validate("history", { hadUkVisaLast10Years: "yes", ukVisaIssueDate: "2016-10-13" }).ukVisaIssueDate).toBeUndefined();
    const visits = validate("history", { ukVisitCount: "once", ukVisits: [{ date: "2016-09", duration: "5 gün", purpose: "Turizm" }] });
    expect(visits["ukVisits.0.date"]).toMatch(/son 10 yıl/);
  });

  it("the range selectable in the date picker matches the rules", () => {
    const field = (sectionId: Parameters<typeof getSection>[0], key: string) => section(sectionId).fields.find((f) => f.key === key) as DateField;
    expect(dateLimits(field("travel", "departureDate"), {}, {}, TEST_TODAY)).toEqual({ min: TEST_TODAY, max: null });
    expect(dateLimits(field("travel", "returnDate"), { departureDate: "2026-12-10" }, {}, TEST_TODAY)).toEqual({ min: "2026-12-10", max: null });
    // Passport expiry date: cannot be before today or before the day after the issue date.
    expect(dateLimits(field("passport", "expiryDate"), { issueDate: "2026-10-12" }, {}, TEST_TODAY)).toEqual({ min: TEST_TODAY, max: null });
    expect(dateLimits(field("passport", "issueDate"), {}, { personal: { birthDate: "1990-05-05" } }, TEST_TODAY)).toEqual({ min: "1990-05-05", max: TEST_TODAY });
    expect(dateLimits(field("history", "ukVisaIssueDate"), {}, {}, TEST_TODAY)).toEqual({ min: "2016-10-13", max: TEST_TODAY });
    const parent = (section("family").fields.find((f) => f.key === "father") as { fields: readonly Field[] }).fields.find((f) => f.key === "birthDate") as DateField;
    expect(dateLimits(parent, {}, { personal: { birthDate: "1990-05-05" } }, TEST_TODAY)).toEqual({ min: null, max: "1990-05-04" });
    const addresses = section("contact").fields.find((f) => f.key === "previousAddresses") as RepeatField;
    const endDate = addresses.fields.find((f) => f.key === "endDate") as MonthField;
    expect(dateLimits(endDate, { startDate: "2020-05" }, {}, TEST_TODAY)).toEqual({ min: "2020-05", max: "2026-10" });
  });

  it("a typed date is read as DD.MM.YYYY or YYYY-MM-DD", () => {
    expect(parseDateInput("19.10.2026")).toBe("2026-10-19");
    expect(parseDateInput("1.2.2026")).toBe("2026-02-01");
    expect(parseDateInput("19/10/2026")).toBe("2026-10-19");
    expect(parseDateInput("2026-10-19")).toBe("2026-10-19");
    expect(parseDateInput("31.02.2026")).toBeNull();
    expect(parseDateInput("19.10")).toBeNull();
    expect(parseDateInput("")).toBeNull();
  });

  it("dots are added automatically while typing a date (also between month and year)", () => {
    // Every keystroke gets the previous masked text + the new digit.
    let text = "";
    for (const key of "19102026") text = maskDateTyping(text + key);
    expect(text).toBe("19.10.2026");
    expect(maskDateTyping("19.102")).toBe("19.10.2");
    expect(maskDateTyping("19.10.20261")).toBe("19.10.2026");
    expect(maskDateTyping("1.2.2026")).toBe("01.02.2026");
    // A space ends the day and month and zero-pads a single digit: 1 → space → 2 → space → 1995.
    let spaced = "";
    for (const key of "1 2 1995") spaced = maskDateTyping(spaced + key);
    expect(spaced).toBe("01.02.1995");
    expect(maskDateTyping("1 ")).toBe("01.");
    expect(maskDateTyping("01.2 ")).toBe("01.02.");
    expect(maskDateTyping("19/10/2026")).toBe("19.10.2026");
    expect(maskDateTyping("19.")).toBe("19.");
    expect(maskDateTyping("19..10")).toBe("19.10");
    expect(maskDateTyping("ab19")).toBe("19");
  });

  it("the appointment time is typed: the colon is added automatically and an invalid time is not accepted", () => {
    let text = "";
    for (const key of "0930") text = maskTimeTyping(text + key);
    expect(text).toBe("09:30");
    expect(maskTimeTyping("9.45")).toBe("9:45");
    expect(maskTimeTyping("12345")).toBe("12:34");
    expect(parseTimeInput("09:30")).toBe("09:30");
    expect(parseTimeInput("9:05")).toBe("09:05");
    expect(parseTimeInput("0930")).toBe("09:30");
    expect(parseTimeInput("24:00")).toBeNull();
    expect(parseTimeInput("12:60")).toBeNull();
    expect(parseTimeInput("9:5")).toBeNull();
  });

  it("a form without any answer counts as 'not started' (even if a section without required fields looks complete when empty)", () => {
    expect(formHasAnyAnswer({})).toBe(false);
    expect(formHasAnyAnswer({ additional: {} })).toBe(false);
    expect(formHasAnyAnswer({ personal: { firstName: "Deneme" } })).toBe(true);
  });

  it("accepts the passport number as alphanumeric, not numeric", () => {
    expect(validate("passport", { passportNo: "U12345678" }).passportNo).toBeUndefined();
    expect(validate("passport", { passportNo: "A1" }).passportNo).toMatch(/5–15/);
    expect(validate("passport", { passportNo: "U123-4567" }).passportNo).toMatch(/harf ve rakam/);
  });

  it("conditional fields are only required when visible", () => {
    expect(validate("contact", { addressChangedLastTwoYears: "no" }).previousAddresses).toBeUndefined();
    const yes = validate("contact", { addressChangedLastTwoYears: "yes", previousAddresses: [] });
    expect(yes.previousAddresses).toMatch(/En az bir kayıt/);
    const item = validate("contact", { addressChangedLastTwoYears: "yes", previousAddresses: [{ address: "", startDate: "2020-05", endDate: "2019-01" }] });
    expect(item["previousAddresses.0.address"]).toBe("Bu alan zorunludur.");
    expect(item["previousAddresses.0.endDate"]).toMatch(/önce olamaz/);
  });

  it("spouse details are only asked if the marital status is 'Evli' (married; a cross-section condition)", () => {
    const single = validateSection(section("family"), minimalSampleForm.family!, minimalSampleForm, TEST_TODAY);
    expect(Object.keys(single).filter((k) => k.startsWith("spouse"))).toEqual([]);
    const married: FormData = { ...minimalSampleForm, personal: { ...minimalSampleForm.personal, maritalStatus: "married" } };
    const errors = validateSection(section("family"), minimalSampleForm.family!, married, TEST_TODAY);
    expect(errors["spouse.firstName"]).toBe("Bu alan zorunludur.");
    expect(errors["spouse.livesWithApplicant"]).toMatch(/Evet veya Hayır/);
  });

  it("nested conditions: the address if the child does not live with the applicant, nationality and passport if they will travel", () => {
    const errors = validate("family", {
      hasDependents: "yes",
      children: [{ fullName: "Test Çocuk", birthDate: "2015-01-01", livesWithApplicant: "no", address: "", travelsWithApplicant: "yes", nationality: "", passportNo: "" }],
    });
    expect(errors["children.0.address"]).toBeDefined();
    expect(errors["children.0.nationality"]).toBeDefined();
    expect(errors["children.0.passportNo"]).toBeDefined();
  });

  it("accommodation: if arranged the type, then hotel details or the host's details depending on the type", () => {
    expect(validate("travel", { hasAccommodation: "no" }).accommodationType).toBeUndefined();
    expect(validate("travel", { hasAccommodation: "yes" }).accommodationType).toMatch(/seçim yapınız/);

    const hotel = validate("travel", { hasAccommodation: "yes", accommodationType: "hotel" });
    expect(hotel["hotel.name"]).toBe("Bu alan zorunludur.");
    expect(hotel["hotel.address"]).toBe("Bu alan zorunludur.");
    expect(Object.keys(hotel).filter((k) => k.startsWith("host"))).toEqual([]);

    const host = validate("travel", { hasAccommodation: "yes", accommodationType: "host", host: { email: "gecersiz" } });
    expect(host["host.firstName"]).toBe("Bu alan zorunludur.");
    expect(host["host.lastName"]).toBe("Bu alan zorunludur.");
    expect(host["host.address"]).toBe("Bu alan zorunludur.");
    expect(host["host.email"]).toMatch(/Geçerli bir e-posta/);
    expect(host["host.phone"]).toBe("Bu alan zorunludur.");
    expect(Object.keys(host).filter((k) => k.startsWith("hotel"))).toEqual([]);

    // "Diğer" (other; e.g. Airbnb): only the place and the address are asked.
    const other = validate("travel", { hasAccommodation: "yes", accommodationType: "other" });
    expect(Object.keys(other).filter((k) => k.startsWith("otherAccommodation")).sort()).toEqual([
      "otherAccommodation.address",
      "otherAccommodation.place",
    ]);
    expect(Object.keys(other).filter((k) => k.startsWith("hotel") || k.startsWith("host"))).toEqual([]);
  });

  it("if the purpose of travel is 'Diğer' an explanation is asked; if travelling with a group, the group's name", () => {
    expect(validate("travel", { purpose: "other" }).purposeOther).toBe("Bu alan zorunludur.");
    expect(validate("travel", { purpose: "education" }).purposeOther).toBeUndefined();
    expect(validate("travel", { travelsWithGroup: "" }).travelsWithGroup).toMatch(/Evet veya Hayır/);
    expect(validate("travel", { travelsWithGroup: "yes" }).groupName).toBe("Bu alan zorunludur.");
    expect(validate("travel", { travelsWithGroup: "no" }).groupName).toBeUndefined();
  });

  it("if employed, the workplace name, address, phone and start month are required", () => {
    const employed = validate("employment", { isEmployed: "yes" });
    for (const key of ["workplaceName", "workplaceAddress", "workplacePhone", "employmentStartDate"]) {
      expect(employed[key], key).toBeDefined();
    }
    expect(employed.employmentStartDate).toBe("Lütfen ay ve yıl seçiniz.");
    const notEmployed = validate("employment", { isEmployed: "no" });
    expect(Object.keys(notEmployed).filter((k) => k.startsWith("workplace") || k === "employmentStartDate")).toEqual([]);
    expect(validate("employment", { isEmployed: "" }).isEmployed).toMatch(/Evet veya Hayır/);
  });

  it("the job start date is stored as month-year; an old full date is reduced to month-year", () => {
    expect(normalizeSectionData(section("employment"), { employmentStartDate: "2015-09-01" }).employmentStartDate).toBe("2015-09");
    expect(normalizeSectionData(section("employment"), { employmentStartDate: "2015-09" }).employmentStartDate).toBe("2015-09");
    expect(normalizeSectionData(section("employment"), { employmentStartDate: "09.2015" }).employmentStartDate).toBe("");
  });

  it("the passport number of the single travel companion is required", () => {
    const companion = { firstName: "Test", lastName: "Kişi", nationality: "TUR", relationship: "Arkadaşı" };
    const missing = validate("travel", { hasCompanions: "yes", companion: { ...companion, passportNo: "" } });
    expect(missing["companion.passportNo"]).toBe("Bu alan zorunludur.");
    const invalid = validate("travel", { hasCompanions: "yes", companion: { ...companion, passportNo: "U12-345" } });
    expect(invalid["companion.passportNo"]).toMatch(/harf ve rakam/);
    const valid = validate("travel", { hasCompanions: "yes", companion: { ...companion, passportNo: "U1234567" } });
    expect(valid["companion.passportNo"]).toBeUndefined();
    const field = section("travel").fields.find((f) => f.key === "companion");
    expect(field?.type).toBe("group");
  });

  it("if a parent has not always had the same nationality, previous nationalities are asked", () => {
    const parent = { firstName: "Test", lastName: "Kişi", birthDate: "1960-01-01", nationality: "TUR" };
    const same = validate("family", { mother: { ...parent, alwaysSameNationality: "yes" } });
    expect(same["mother.previousNationalities"]).toBeUndefined();
    const none = validate("family", { mother: { ...parent, alwaysSameNationality: "no", previousNationalities: [] } });
    expect(none["mother.previousNationalities"]).toMatch(/En az bir kayıt/);
    const blank = validate("family", { mother: { ...parent, alwaysSameNationality: "no", previousNationalities: [{ nationality: "" }] } });
    expect(blank["mother.previousNationalities.0.nationality"]).toBe("Lütfen bir seçim yapınız.");
  });

  it("if there are relatives in the United Kingdom, all fields that open are required", () => {
    const errors = validate("family", { hasUkRelative: "yes", ukRelative: {} });
    for (const key of ["fullName", "relationship", "nationality", "status", "passportNo", "email", "address", "staysWithRelative"]) {
      expect(errors[`ukRelative.${key}`], key).toBeDefined();
    }
    expect(Object.keys(validate("family", { hasUkRelative: "no" })).filter((k) => k.startsWith("ukRelative"))).toEqual([]);
  });

  it("if there was a UK refusal, the number, dates and reasons are asked in one explanation field", () => {
    expect(Object.keys(validate("security", { ukRefusal: "no" })).filter((k) => k.startsWith("ukRefusal") && k !== "ukRefusal")).toEqual([]);
    const errors = validate("security", { ukRefusal: "yes" });
    expect(errors.ukRefusalDetails).toBe("Bu alan zorunludur.");
    expect(Object.keys(errors).filter((k) => k.startsWith("ukRefusal"))).toEqual(["ukRefusalDetails"]);
    const question = section("security").fields.find((f) => f.key === "ukRefusal");
    expect(question?.label).toMatch(/\(Ret sayısı, ret tarihleri ve ret sebepleri\)$/);
    expect(section("security").fields.map((f) => f.key)).toEqual(["ukRefusal", "ukRefusalDetails", "otherRefusal", "otherRefusalDetails"]);
  });

  it("section names are the same in the progress tiles and the page title; sections have no description", () => {
    for (const s of FORM_SECTIONS) {
      expect(Object.keys(s).sort(), s.id).toEqual(["fields", "id", "title"]);
    }
  });

  it("the employment status of the person paying the expenses is asked, and an explanation if it is 'Diğer'", () => {
    const sponsor = { firstName: "Test", lastName: "Kişi", address: "Test Sokak No: 1" };
    const missing = validate("employment", { hasExpenseSponsor: "yes", expenseSponsor: sponsor });
    expect(missing["expenseSponsor.employmentStatus"]).toMatch(/seçim yapınız/);
    const other = validate("employment", { hasExpenseSponsor: "yes", expenseSponsor: { ...sponsor, employmentStatus: "other" } });
    expect(other["expenseSponsor.employmentStatusOther"]).toBe("Bu alan zorunludur.");
    const retired = validate("employment", { hasExpenseSponsor: "yes", expenseSponsor: { ...sponsor, employmentStatus: "retired" } });
    expect(Object.keys(retired).filter((k) => k.startsWith("expenseSponsor"))).toEqual([]);
  });

  it("the number of trip entries follows the 'how many times' answer", () => {
    const trip = { date: "2024-05", duration: "5 gün", purpose: "Turizm", country: "FRA" };
    expect(validate("history", { ukVisitCount: "none", ukVisits: [] }).ukVisits).toBeUndefined();
    expect(validate("history", { otherCountriesVisitCount: "once", otherCountriesVisits: [] }).otherCountriesVisits).toMatch(/En az bir kayıt/);
    // "Bir defa" (once) → exactly one trip.
    expect(validate("history", { ukVisitCount: "once", ukVisits: [trip] }).ukVisits).toBeUndefined();
    expect(validate("history", { ukVisitCount: "once", ukVisits: [trip, trip] }).ukVisits).toMatch(/Yalnızca bir kayıt/);
    // For other answers at least one and at most 3 (UK) / 2 (other countries) trips.
    expect(validate("history", { ukVisitCount: "2-5", ukVisits: [trip] }).ukVisits).toBeUndefined();
    expect(validate("history", { ukVisitCount: "2-5", ukVisits: [trip, trip, trip] }).ukVisits).toBeUndefined();
    expect(validate("history", { ukVisitCount: "6+", ukVisits: [trip, trip, trip, trip] }).ukVisits).toMatch(/En fazla 3 kayıt/);
    const uk = section("history").fields.find((f) => f.key === "ukVisits") as RepeatField;
    const other = section("history").fields.find((f) => f.key === "otherCountriesVisits") as RepeatField;
    expect(repeatLimits(uk, { ukVisitCount: "once" }, {})).toEqual({ min: 1, max: 1 });
    expect(repeatLimits(uk, { ukVisitCount: "2-5" }, {})).toEqual({ min: 1, max: 3 });
    expect(repeatLimits(uk, { ukVisitCount: "6+" }, {})).toEqual({ min: 1, max: 3 });
    expect(repeatLimits(other, { otherCountriesVisitCount: "2-5" }, {})).toEqual({ min: 1, max: 2 });
    expect(repeatLimits(other, { otherCountriesVisitCount: "6+" }, {})).toEqual({ min: 1, max: 2 });
    // Once visible, one empty entry is opened.
    const opened = ensureRepeatMinimums(section("history"), { ukVisitCount: "2-5" }, {});
    expect(opened.ukVisits).toHaveLength(1);
  });

  it("when the answer drops to 'Bir defa' (once) the extra trips are removed and the first entry remains", () => {
    const history = section("history");
    const trip = (country: string) => ({ date: "2024-05", country, purpose: "Turizm", durationDays: "5" });
    const before = { ukVisitCount: "2-5", ukVisits: [trip("A"), trip("B"), trip("C")], otherCountriesVisitCount: "6+", otherCountriesVisits: [trip("D"), trip("E")] };

    // Nothing is deleted while the count is unchanged; the same object is returned.
    const same = trimRepeatMaximums(history, before, {});
    expect(same.trimmed).toEqual([]);
    expect(same.data).toBe(before);

    const once = trimRepeatMaximums(history, { ...before, ukVisitCount: "once", otherCountriesVisitCount: "once" }, {});
    expect(once.trimmed).toEqual(["ukVisits", "otherCountriesVisits"]);
    expect(once.data.ukVisits).toEqual([trip("A")]);
    expect(once.data.otherCountriesVisits).toEqual([trip("D")]);
    expect(validateSection(history, once.data, {}).ukVisits).toBeUndefined();

    // A hidden list ("I've never been") is not deleted by this function; pruneFormData clears hidden answers.
    const never = trimRepeatMaximums(history, { ...before, ukVisitCount: "never" }, {});
    expect(never.trimmed).not.toContain("ukVisits");
  });
});

describe("required field counter (the form's bottom bar)", () => {
  it("counts visible required fields and the filled ones", () => {
    const personal = section("personal");
    const required = personal.fields.filter((f) => f.type !== "group" && f.type !== "repeat" && f.required).length;
    expect(countRequiredFields(personal, {}, {})).toEqual({ filled: 0, total: required });
    expect(countRequiredFields(personal, { firstName: "Örnek", maidenName: "Örnek" }, {})).toEqual({ filled: 1, total: required });
    // In the fully filled sample all are filled.
    const full = countRequiredFields(personal, minimalSampleForm.personal!, minimalSampleForm);
    expect(full.filled).toBe(full.total);
  });

  it("does not count hidden conditional fields; counts the fields of repeated entries per entry", () => {
    const contact = section("contact");
    const base = { ...(minimalSampleForm.contact ?? {}) };
    const hidden = countRequiredFields(contact, { ...base, addressChangedLastTwoYears: "no" }, minimalSampleForm);
    const oneItem = countRequiredFields(contact, { ...base, addressChangedLastTwoYears: "yes", previousAddresses: [{ address: "", startDate: "", endDate: "" }] }, minimalSampleForm);
    const twoItems = countRequiredFields(
      contact,
      { ...base, addressChangedLastTwoYears: "yes", previousAddresses: [{ address: "", startDate: "", endDate: "" }, { address: "Örnek adres", startDate: "", endDate: "" }] },
      minimalSampleForm,
    );
    expect(oneItem.total).toBeGreaterThan(hidden.total);
    expect(twoItems.total - oneItem.total).toBe(oneItem.total - hidden.total);
    expect(twoItems.filled).toBe(oneItem.filled + 1);
  });
});

describe("clearing hidden fields", () => {
  it("deletes old answers of fields whose condition is not met", () => {
    const stale: FormData = {
      ...minimalSampleForm,
      contact: {
        ...minimalSampleForm.contact,
        addressChangedLastTwoYears: "no",
        previousAddresses: [{ address: "ESKİ ADRES", startDate: "2020-01", endDate: "2021-01" }],
      },
      // Accommodation switched to "Hayır"; the old sub-choice ("hotel") and old hotel/host details are still in the record.
      travel: {
        ...minimalSampleForm.travel,
        purpose: "tourism",
        business: { companyName: "ESKİ ŞİRKET" },
        hasAccommodation: "no",
        accommodationType: "hotel",
        hotel: { name: "ESKİ OTEL" },
        host: { address: "ESKİ EV SAHİBİ ADRESİ" },
      },
      family: {
        ...minimalSampleForm.family,
        spouse: { firstName: "ESKİ EŞ" },
        hasDependents: "yes",
        children: [{ fullName: "Çocuk", livesWithApplicant: "yes", address: "ESKİ ÇOCUK ADRESİ", travelsWithApplicant: "no", passportNo: "ESKI123" }],
      },
      security: { ukRefusal: "no", ukRefusalDetails: "ESKİ AÇIKLAMA", otherRefusal: "no" },
    };
    const pruned = pruneFormData(stale);
    const text = JSON.stringify(pruned);
    for (const leaked of [
      "ESKİ ADRES",
      "ESKİ ŞİRKET",
      "ESKİ OTEL",
      "ESKİ EV SAHİBİ ADRESİ",
      "ESKİ EŞ",
      "ESKİ ÇOCUK ADRESİ",
      "ESKI123",
      "ESKİ AÇIKLAMA",
      "ESKİ SEBEP",
    ]) {
      expect(text, leaked).not.toContain(leaked);
    }
    // Visible data is kept.
    expect((pruned.family!.children as Array<Record<string, unknown>>)[0]!.fullName).toBe("Çocuk");
  });

  it("does not touch visible fields", () => {
    expect(pruneFormData(fullSampleForm).travel).toEqual(normalizeSectionData(section("travel"), fullSampleForm.travel));
  });

  it("the summary view lists only visible fields with their formatted values", () => {
    const nodes = buildSectionDisplay(section("personal"), pruneFormData(minimalSampleForm));
    const values = Object.fromEntries(nodes.filter((n) => n.kind === "value").map((n) => [n.label, n.kind === "value" ? n.value : ""]));
    expect(values["Cinsiyetiniz"]).toBe("Erkek");
    expect(values["Doğum tarihiniz"]).toBe("01.01.1990");
    const family = buildSectionDisplay(section("family"), pruneFormData(minimalSampleForm));
    expect(family.some((n) => n.key === "spouse")).toBe(false);
    const employment = buildSectionDisplay(section("employment"), pruneFormData(minimalSampleForm));
    expect(employment.find((n) => n.key === "monthlyNetIncome")).toMatchObject({ value: "50.000 TL" });
  });
});

describe("tekrarlanabilir alanlar", () => {
  it("opens the minimum number of empty entries when the condition is met, none when it is not", () => {
    const contact = section("contact");
    const no = ensureRepeatMinimums(contact, normalizeSectionData(contact, { addressChangedLastTwoYears: "no" }), {});
    expect(no.previousAddresses).toEqual([]);
    const yes = ensureRepeatMinimums(contact, normalizeSectionData(contact, { addressChangedLastTwoYears: "yes" }), {});
    expect(yes.previousAddresses).toEqual([{ address: "", startDate: "", endDate: "" }]);
  });

  it("setting a value by path does not change other entries", () => {
    const data = { children: [{ fullName: "A" }, { fullName: "B" }] };
    const next = setAtPath(data, "children.1.fullName", "C");
    expect(next).toEqual({ children: [{ fullName: "A" }, { fullName: "C" }] });
    expect(data.children[1]!.fullName).toBe("B");
  });
});

describe("field help", () => {
  it("ignores the index in repeated entries", () => {
    expect(helpKeyFor("family", "children.2.passportNo")).toBe("family.children.passportNo");
    expect(helpKeyFor("passport", "issuingAuthority")).toBe("passport.issuingAuthority");
  });

  it("help is defined for the passport issuing authority field; returns null for an undefined field", () => {
    expect(getFieldHelp("passport", "issuingAuthority")?.title).toBe("Pasaportu veren makam");
    expect(getFieldHelp("personal", "firstName")).toBeNull();
  });

  it("every help entry points to an existing form field and has alt text if it has an image", () => {
    const paths = new Set<string>();
    const walk = (fields: readonly Field[], prefix: string) => {
      for (const field of fields) {
        const path = `${prefix}.${field.key}`;
        paths.add(path);
        if (field.type === "group" || field.type === "repeat") walk(field.fields, path);
      }
    };
    for (const s of FORM_SECTIONS) walk(s.fields, s.id);
    for (const [key, help] of Object.entries(FIELD_HELP)) {
      expect(paths.has(key), key).toBe(true);
      if (help.image) {
        expect(help.imageAlt, key).toBeTruthy();
        expect(help.image, key).toMatch(/^[a-z0-9-]+\.(png|jpg|jpeg|webp|svg)$/);
      }
    }
  });
});
