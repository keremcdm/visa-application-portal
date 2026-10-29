import { describe, expect, it } from "vitest";
import {
  buildChecklistPdfFileName,
  buildFormPdfFileName,
  buildZipFileName,
  contentDispositionAttachment,
  contentDispositionInline,
  isSafeFolderName,
  sanitizeDisplayFileName,
  sanitizeNamePart,
  slugForFileName,
  transliterate,
} from "@/features/export/filenames";

describe("form PDF file name", () => {
  it("has the form 'Name Surname - Application number.pdf'; Turkish characters become ASCII; Isimsiz if there is no name", () => {
    expect(buildFormPdfFileName({ firstName: "Şükrü", lastName: "Öztürk", referenceCode: "VB-2026-000123" })).toBe("Sukru Ozturk - VB-2026-000123.pdf");
    expect(buildFormPdfFileName({ firstName: "", lastName: null, referenceCode: "VB-2026-000123" })).toBe("Isimsiz - VB-2026-000123.pdf");
    expect(contentDispositionAttachment(buildFormPdfFileName({ firstName: "Ayşe", lastName: "Kaya", referenceCode: "VB-2026-000123" }))).toBe(
      "attachment; filename=\"Ayse Kaya - VB-2026-000123.pdf\"; filename*=UTF-8''Ayse%20Kaya%20-%20VB-2026-000123.pdf",
    );
  });
});

describe("document checklist PDF file name", () => {
  it("'Evrak listesi - Application number.pdf'; opens in the browser (inline)", () => {
    expect(buildChecklistPdfFileName("VB-2026-000123")).toBe("Evrak listesi - VB-2026-000123.pdf");
    expect(contentDispositionInline(buildChecklistPdfFileName("VB-2026-000123"))).toBe(
      "inline; filename=\"Evrak listesi - VB-2026-000123.pdf\"; filename*=UTF-8''Evrak%20listesi%20-%20VB-2026-000123.pdf",
    );
  });
});

describe("ZIP file name", () => {
  it("produces the NameSurname - NationalIdNo.zip format", () => {
    expect(buildZipFileName({ tcNo: "12345678901", firstName: "Ahmet", lastName: "Yılmaz", fallbackId: "VB-2026-000001" })).toBe(
      "Ahmet Yilmaz - 12345678901.zip",
    );
  });

  it("converts Turkish characters to their ASCII equivalents", () => {
    expect(transliterate("ÇĞİÖŞÜ çğıöşü")).toBe("CGIOSU cgiosu");
    expect(buildZipFileName({ tcNo: "10000000146", firstName: "Şükrü Çağrı", lastName: "Öztürk-Işık", fallbackId: "X" })).toBe(
      "Sukru Cagri Ozturk-Isik - 10000000146.zip",
    );
  });

  it("keeps leading zeros and digits as they are (handled as text)", () => {
    // Real national ID numbers never start with 0; here we verify the value is not converted to a number.
    expect(buildZipFileName({ tcNo: "01234567890", firstName: "A", lastName: "B", fallbackId: "X" })).toBe("A B - 01234567890.zip");
  });

  it("uses the application number if the national ID number is missing or invalid; the name is never empty", () => {
    expect(buildZipFileName({ tcNo: "", firstName: "Ali", lastName: "Veli", fallbackId: "VB-2026-000042" })).toBe(
      "Ali Veli - VB-2026-000042.zip",
    );
    expect(buildZipFileName({ tcNo: "123", firstName: "", lastName: "", fallbackId: "VB-2026-000042" })).toBe(
      "Isimsiz - VB-2026-000042.zip",
    );
    expect(buildZipFileName({ tcNo: null, firstName: null, lastName: null, fallbackId: "" })).toBe("Isimsiz - Basvuru.zip");
  });

  it("neutralizes names containing path manipulation", () => {
    const name = buildZipFileName({
      tcNo: "../../etc/passwd",
      firstName: "..\\..\\Windows",
      lastName: "System32/../../x",
      fallbackId: "../../../root",
    });
    expect(name).not.toMatch(/[\\/]/);
    expect(name).not.toContain("..");
    expect(name.endsWith(".zip")).toBe(true);
  });

  it("removes invalid file name characters and control characters", () => {
    expect(sanitizeNamePart('a<b>c:d"e|f?g*h\u0000i\nj')).toBe("a b c d e f g h i j");
    expect(sanitizeNamePart("   ...gizli...   ")).toBe("gizli");
    expect(sanitizeNamePart("....")).toBe("");
    expect(sanitizeNamePart("😀😀")).toBe("");
  });

  it("replaces Windows reserved names", () => {
    expect(sanitizeNamePart("CON")).toBe("_CON");
    expect(sanitizeNamePart("nul")).toBe("_nul");
    expect(sanitizeNamePart("COM1")).toBe("_COM1");
    expect(sanitizeNamePart("Console")).toBe("Console");
  });

  it("shortens very long names", () => {
    expect(sanitizeNamePart("a".repeat(500), 80)).toHaveLength(80);
  });
});

describe("document file name and folder name", () => {
  it("produces an underscored ASCII name from the document name", () => {
    expect(slugForFileName("Geçerli pasaport")).toBe("Gecerli_pasaport");
    expect(slugForFileName("Son üç aylık, bakiyeli banka hesap dökümü")).toBe("Son_uc_aylik_bakiyeli_banka_hesap_dokumu");
    expect(slugForFileName("../../x")).toBe("x");
  });

  it("accepts the company's folder names with their spelling", () => {
    for (const name of ["accomodation", "financial evidence", "life events", "other", "pasaport", "proof of business", "sponsor"]) {
      expect(isSafeFolderName(name)).toBe(true);
    }
  });

  it("rejects dangerous folder names", () => {
    for (const name of ["", ".", "..", "a/b", "a\\b", "../x", "C:", "con", " bosluk", "bosluk ", "nokta.", "a\u0000b", "x".repeat(61)]) {
      expect(isSafeFolderName(name)).toBe(false);
    }
  });
});

describe("download header and display name", () => {
  it("allows no quote or line break injection in the Content-Disposition value", () => {
    const header = contentDispositionAttachment('x"\r\nSet-Cookie: a=b.zip');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header.match(/"/g)).toHaveLength(2);
    expect(header.startsWith('attachment; filename="')).toBe(true);
  });

  it("keeps the ZIP name in the header", () => {
    expect(contentDispositionAttachment("12345678901 - Ahmet Yilmaz.zip")).toContain('filename="12345678901 - Ahmet Yilmaz.zip"');
  });

  it("drops path information from the customer's file name", () => {
    expect(sanitizeDisplayFileName("C:\\Users\\x\\Desktop\\pasaport.pdf")).toBe("pasaport.pdf");
    expect(sanitizeDisplayFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeDisplayFileName("..")).toBe("dosya");
    expect(sanitizeDisplayFileName("")).toBe("dosya");
    expect(sanitizeDisplayFileName("Nüfus cüzdanı ön.jpg")).toBe("Nüfus cüzdanı ön.jpg");
  });
});
