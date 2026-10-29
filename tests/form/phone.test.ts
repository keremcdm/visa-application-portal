import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { composePhone, parsePhone, phoneCountry, PINNED_PHONE_COUNTRIES, SORTED_PHONE_COUNTRIES } from "@/features/application-form/phone";
import { MAIN_COUNTRY_BY_DIAL_CODE, PHONE_COUNTRIES } from "@/lib/domain/phone-codes";
import { isValidPhone, telHref } from "@/lib/validation/formats";

describe("phone country code list", () => {
  it("Türkiye +90, United Kingdom +44; every country once and in Turkish alphabetical order", () => {
    expect(phoneCountry("TR")).toMatchObject({ name: "Türkiye", dialCode: "+90" });
    expect(phoneCountry("GB")).toMatchObject({ name: "Birleşik Krallık", dialCode: "+44" });
    const codes = PHONE_COUNTRIES.map((c) => c.iso2);
    expect(new Set(codes).size).toBe(codes.length);
    const names = PHONE_COUNTRIES.map((c) => c.name);
    expect(names).toEqual([...names].sort(new Intl.Collator("tr").compare));
  });

  it("every country has a sample number shown greyed out in the field; the sample is a valid number", () => {
    expect(phoneCountry("TR").example).toBe("501 234 56 78");
    expect(phoneCountry("GB").example).toBe("7400 123456");
    for (const country of PHONE_COUNTRIES) {
      expect(country.example, country.iso2).not.toBe("");
      expect(isValidPhone(composePhone(country, country.example)), country.iso2).toBe(true);
    }
  });

  it("Türkiye and the United Kingdom at the top; not repeated in the list below", () => {
    expect(PINNED_PHONE_COUNTRIES.map((c) => c.iso2)).toEqual(["TR", "GB"]);
    expect(SORTED_PHONE_COUNTRIES.some((c) => c.iso2 === "TR" || c.iso2 === "GB")).toBe(false);
    expect(PINNED_PHONE_COUNTRIES.length + SORTED_PHONE_COUNTRIES.length).toBe(PHONE_COUNTRIES.length);
  });

  it("every country marked as having a flag has a flag file", () => {
    const missing = PHONE_COUNTRIES.filter((c) => c.flag && !existsSync(path.join(process.cwd(), "public", "flags", `${c.iso2.toLowerCase()}.svg`)));
    expect(missing.map((c) => c.iso2)).toEqual([]);
  });

  it("a main country is defined among countries sharing a code", () => {
    expect(MAIN_COUNTRY_BY_DIAL_CODE["+1"]).toBe("US");
    expect(MAIN_COUNTRY_BY_DIAL_CODE["+44"]).toBe("GB");
  });
});

describe("splitting and joining phone numbers", () => {
  it("splits the country code and the number", () => {
    expect(parsePhone("+90 532 123 45 67")).toEqual({ dialCode: "+90", iso2: "TR", national: "532 123 45 67" });
    expect(parsePhone("+44 7911 123456")).toEqual({ dialCode: "+44", iso2: "GB", national: "7911 123456" });
    expect(parsePhone("+1 202 555 0100")).toMatchObject({ dialCode: "+1", iso2: "US" });
    expect(parsePhone("+905321234567")).toEqual({ dialCode: "+90", iso2: "TR", national: "5321234567" });
  });

  it("treats an old number saved without a country code as a Turkish number; the leading 0 is not shown", () => {
    expect(parsePhone("0532 123 45 67")).toEqual({ dialCode: null, iso2: "TR", national: "532 123 45 67" });
    expect(parsePhone("")).toEqual({ dialCode: null, iso2: "TR", national: "" });
  });

  it("a trailing space added while typing is kept", () => {
    expect(parsePhone(composePhone(phoneCountry("TR"), "532 ")).national).toBe("532 ");
  });

  it("if the number is empty the value is empty; otherwise it is joined with the country code", () => {
    expect(composePhone(phoneCountry("GB"), "")).toBe("");
    expect(composePhone(phoneCountry("GB"), "   ")).toBe("");
    expect(composePhone(phoneCountry("GB"), "7911 123456")).toBe("+44 7911 123456");
  });

  it("a number with +90 and a leading 0 is invalid; other formats are valid", () => {
    expect(isValidPhone("+90 0532 123 45 67")).toBe(false);
    expect(isValidPhone("+90 532 123 45 67")).toBe(true);
    expect(isValidPhone("+90 532 123 45")).toBe(false);
    expect(isValidPhone("0532 123 45 67")).toBe(true);
    expect(isValidPhone("+44 7911 123456")).toBe(true);
    expect(isValidPhone("+690 7290")).toBe(true);
    expect(isValidPhone("+690 729")).toBe(false);
    expect(isValidPhone("+44 1234 5678 9012 34")).toBe(false);
  });
});

describe("contact phone link", () => {
  it("a tel: link keeps only digits and a leading +; no link if invalid", () => {
    expect(telHref("+90 (212) 555 01 23")).toBe("tel:+902125550123");
    expect(telHref("0212 555 01 23")).toBe("tel:02125550123");
    expect(telHref("Telefon yok")).toBeNull();
    expect(telHref(null)).toBeNull();
  });
});
