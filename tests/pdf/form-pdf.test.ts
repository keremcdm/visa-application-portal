import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { pruneFormData } from "@/features/application-form/engine";
import type { FormData } from "@/features/application-form/types";
import { loadFormPdfAssets } from "@/features/form-pdf/assets";
import { FORM_TEMPLATES, generateFormPdf, type FormPdfAssets } from "@/features/form-pdf/generate";
import { buildUkInfoFormPlacements, UK_INFO_FORM_PAGE_COUNT } from "@/features/form-pdf/templates/uk-info-form";
import { fullSampleForm, minimalSampleForm, TEST_NATIONAL_ID } from "../fixtures/sample-form";
import { extractPdfText, type PdfTextItem } from "../helpers/pdf-text";

const template = FORM_TEMPLATES["uk-info-form"];
const OUT_DIR = path.join(process.cwd(), "tmp");
const GENERATED_AT = new Date("2026-10-13T09:30:00Z");

/** Bounds of the right (answer) column and of the table. */
const COLUMN_DIVIDER = 219.2;
const TABLE_RIGHT = 557.8;

let assets: FormPdfAssets;
let blankItems: PdfTextItem[];

const squash = (s: string) => s.replace(/\s+/g, "");
const keyOf = (i: PdfTextItem) => `${i.page}|${i.str}|${i.x.toFixed(1)}|${i.y.toFixed(1)}`;

async function generate(formData: FormData, name: string) {
  const result = await generateFormPdf({ template, assets, formData, referenceCode: "VB-TEST-000001", generatedAt: GENERATED_AT });
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, name), result.bytes);
  const text = await extractPdfText(result.bytes);
  const blankKeys = new Set(blankItems.map(keyOf));
  // Text items we added that are not in the template (excluding the footer line).
  const added = text.items.filter((i) => i.page < UK_INFO_FORM_PAGE_COUNT && !blankKeys.has(keyOf(i)) && i.y > 30);
  return { result, text, added, all: squash(text.pages.join("\n")) };
}

beforeAll(async () => {
  assets = await loadFormPdfAssets(template);
  blankItems = (await extractPdfText(assets.template)).items;
});

describe("form PDF output – full sample", () => {
  it("the template's 5 pages are kept and an appendix page is added for overflowing entries", async () => {
    const { result, text } = await generate(fullSampleForm, "ornek-form-tam.pdf");
    expect(text.pageCount).toBeGreaterThan(UK_INFO_FORM_PAGE_COUNT);
    expect(result.pageCount).toBe(text.pageCount);
    // The template's own text stays in place.
    expect(squash(text.pages[0]!)).toContain("ADINIZ");
    expect(squash(text.pages[4]!)).toContain("YADAPROBLEM");
  });

  it("every answer the customer gave is in the output", async () => {
    const { all } = await generate(fullSampleForm, "ornek-form-tam.pdf");
    const expected = [
      "Ayşe Gül",
      "Örnekoğlu",
      "Çalışkan",
      "Örnek Mahallesi, Deneme Sokak No: 12 Daire: 5, 34000 Kadıköy / İstanbul",
      "1 yıl 4 ay",
      "Test Caddesi No: 45/3, Çankaya / Ankara",
      "06.2019",
      "02.2023",
      "Kurgu Bulvarı No: 7 Kat: 2, Konak / İzmir",
      "0532 000 00 00",
      "ornek.kisi@example.com",
      "Kadın",
      "Evli",
      "07.03.1985",
      "Kadıköy / İstanbul",
      TEST_NATIONAL_ID,
      "U00000000",
      "İstanbul Valiliği",
      "10.05.2022",
      "09.05.2032",
      "Bulgaristan",
      "X1234567",
      "Örnekşehir",
      "15.01.2020",
      "14.01.2030",
      "Mali Müşavir",
      "Örnek Danışmanlık Ltd. Şti.",
      "Şablon İş Merkezi B Blok Kat: 4 No: 41, Şişli / İstanbul",
      "0212 000 00 00",
      "09.2015",
      "85.000 TL",
      "40.000 TL",
      "10.12.2026 – 20.12.2026",
      "Ticari",
      "Sample Trading Co.",
      "Tekstil ithalatı",
      "1 Example Street, London",
      "+44 20 0000 0000",
      "contact@example.co.uk",
      "John Example",
      "21.11.1983",
      "Evet – U11111111",
      "Zeynep Örnekoğlu",
      "02.04.2012",
      "Evet – Türkiye – U22222222",
      "Emir Örnekoğlu",
      "Hayır – Öğrenci Yurdu, Eskişehir",
      "Defne Örnekoğlu",
      "Fatma",
      "14.02.1958",
      "Hüseyin",
      "30.07.1955",
      "Selin Çalışkan",
      "Kız kardeşi",
      "Süresiz oturum",
      "U33333333",
      "selin@example.co.uk",
      "3 Fictional Avenue, Manchester",
      "Example Hotel London",
      "2 Sample Road, London",
      "Kira geliri: aylık 18.000 TL (Ankara'daki daire).",
      "Vadeli mevduat 450.000 TL (maaş birikimi), altın hesabı 120 gr (aile yadigârı).",
      "12.04.2019",
      "Example Hospital, 4 Test Lane, London",
      "03.06.2019 – 05.06.2019",
      "05.2017",
      "Fuar ziyareti",
      "10.2024",
      "Evet – QQ123456C",
      "20.06.2019",
      "Başvuru geri çekildi",
      "Almanya",
      "Amerika Birleşik Devletleri",
      "Japonya",
      "01.04.2017",
      "12.04.2017",
      "Birleşik Arap Emirlikleri",
      "Azerbaycan",
      "Tayland",
      "22.12.2024",
      "03.01.2025",
      // Fields without their own row in the template: appended to existing cells or written to the appendix page.
      "Evet – iş durumu: Çalışan",
      "Can",
      "Denemeci",
      "Arkadaşı",
      "Türkiye – Pasaport no: U44444444",
      "Grubun adı: Örnek Kültür Turu",
      "Hayır – önceki: Bulgaristan, Kuzey Makedonya",
      "2 ret: 11.2014 ve 05.2015. Sebepler: eksik banka dökümü; yetersiz seyahat planı.",
      "2016 yılında Kurgu Ülkesi turistik vize başvurum eksik evrak nedeniyle reddedildi. Tarih: 14.03.2016.",
      "Seyahatim boyunca şirketim adına iki toplantıya katılacağım; davet mektubu evraklar arasındadır.",
      "VB-TEST-000001",
    ];
    const missing = expected.filter((value) => !all.includes(squash(value)));
    expect(missing).toEqual([]);
  });

  it("entries beyond the template's capacity are written to the appendix page", async () => {
    const { text } = await generate(fullSampleForm, "ornek-form-tam.pdf");
    const appendix = squash(text.pages.slice(UK_INFO_FORM_PAGE_COUNT).join("\n"));
    expect(appendix).toContain("EKSAYFA");
    // 3rd child, group travel details, 7th trip to another country
    expect(appendix).toContain(squash("Bakmakla yükümlü olunan kişi 3"));
    expect(appendix).toContain(squash("Defne Örnekoğlu"));
    expect(appendix).toContain(squash("Grupla seyahat"));
    expect(appendix).toContain(squash("Örnek Kültür Turu"));
    expect(appendix).toContain(squash("Diğer ülke seyahati 7"));
    expect(appendix).toContain("Tayland");
  });

  it("no added text overflows the cell boundaries", async () => {
    const { added } = await generate(fullSampleForm, "ornek-form-tam.pdf");
    expect(added.length).toBeGreaterThan(100);
    const outside = added.filter((i) => {
      const right = i.x + i.width;
      if (i.x >= COLUMN_DIVIDER) return right > TABLE_RIGHT - 1;
      return right > COLUMN_DIVIDER - 1 || i.x < 31;
    });
    expect(outside.map((i) => `${i.page + 1}. sayfa: "${i.str}"`)).toEqual([]);
  });

  it("added text does not overlap the template's own text", async () => {
    const { added } = await generate(fullSampleForm, "ornek-form-tam.pdf");
    const { placements } = buildUkInfoFormPlacements(pruneFormData(fullSampleForm));
    const masks = placements.flatMap((p) => (p.masks ?? []).map((m) => ({ ...m, page: p.page })));
    const collisions: string[] = [];
    for (const item of added) {
      const aTop = item.y + 6.5;
      const aBottom = item.y - 1.5;
      for (const fixed of blankItems) {
        if (fixed.page !== item.page) continue;
        const fTop = fixed.y + 7.5;
        const fBottom = fixed.y - 2;
        if (aBottom >= fTop || fBottom >= aTop) continue;
        const left = Math.max(item.x, fixed.x);
        const right = Math.min(item.x + item.width, fixed.x + fixed.width);
        if (right - left <= 0.5) continue;
        const covered = masks.some(
          (m) => m.page === item.page && m.x <= left + 0.5 && m.x + m.width >= right - 0.5 && m.y <= fixed.y && m.y + m.height >= fixed.y,
        );
        if (!covered) collisions.push(`${item.page + 1}. sayfa: "${item.str}" ↔ "${fixed.str}"`);
      }
    }
    expect(collisions).toEqual([]);
  });
});

describe("form PDF output – conditional fields and overflow", () => {
  it("a form filled with minimal information creates no appendix page", async () => {
    const { result, text, all } = await generate(minimalSampleForm, "ornek-form-asgari.pdf");
    expect(text.pageCount).toBe(UK_INFO_FORM_PAGE_COUNT);
    expect(result.overflow).toEqual([]);
    expect(all).toContain("Deneme");
    expect(all).toContain("YALNIZ");
  });

  it("old answers of hidden conditional fields are not carried into the PDF", async () => {
    // The customer first chose "Evli" (married) and entered spouse details, then switched to "Bekar" (single); the old data is still in the record.
    const stale: FormData = {
      ...minimalSampleForm,
      family: {
        ...minimalSampleForm.family,
        spouse: { firstName: "ESKIES", lastName: "GIZLIKALMALI", birthDate: "1991-01-01", nationality: "TUR" },
        hasUkRelative: "no",
        ukRelative: { fullName: "ESKIAKRABA GIZLI", relationship: "Kuzen" },
      },
      passport: {
        ...minimalSampleForm.passport,
        hasOtherPassport: "no",
        otherPassport: { country: "ISL", passportNo: "ESKI12345" },
      },
      travel: {
        ...minimalSampleForm.travel,
        purpose: "tourism",
        business: { companyName: "ESKISIRKET" },
      },
    };
    const { all } = await generate(stale, "ornek-form-gizli-alan.pdf");
    for (const leaked of ["ESKIES", "GIZLIKALMALI", "ESKIAKRABA", "İzlanda", "ESKI12345", "ESKISIRKET"]) {
      expect(all).not.toContain(leaked);
    }
  });

  it("if staying with someone, the person's details go to the appendix page; the hotel rows stay empty", async () => {
    const form: FormData = {
      ...minimalSampleForm,
      travel: {
        ...minimalSampleForm.travel,
        hasAccommodation: "yes",
        accommodationType: "host",
        // A hotel was chosen first and details entered, then it was switched to "Biriyle kalacağım" (staying with someone).
        hotel: { name: "ESKIOTEL", address: "ESKIOTELADRESI" },
        host: { firstName: "Jane", lastName: "Sample", address: "5 Sample Close, Leeds", email: "host@example.co.uk", phone: "+44 113 000 0000" },
      },
    };
    const { text, all } = await generate(form, "ornek-form-ev-sahibi.pdf");
    const appendix = squash(text.pages.slice(UK_INFO_FORM_PAGE_COUNT).join("\n"));
    expect(appendix).toContain(squash("Konaklama – yanında kalınacak kişi"));
    for (const value of ["Adı: Jane", "Soyadı: Sample", "5 Sample Close, Leeds", "host@example.co.uk", "+44 113 000 0000"]) {
      expect(appendix).toContain(squash(value));
    }
    expect(squash(text.pages[2]!)).toContain(squash("Biriyle kalacak – bilgiler ek sayfada"));
    expect(all).not.toContain("ESKIOTEL");
  });

  it("if the purpose of travel and accommodation are 'Diğer', they are written with their explanations", async () => {
    const form: FormData = {
      ...minimalSampleForm,
      travel: {
        ...minimalSampleForm.travel,
        purpose: "other",
        purposeOther: "Dil kursu",
        hasAccommodation: "yes",
        accommodationType: "other",
        otherAccommodation: { place: "Airbnb", address: "6 Sample Mews, Bristol" },
      },
    };
    const { all } = await generate(form, "ornek-form-diger.pdf");
    expect(all).toContain(squash("Diğer: Dil kursu"));
    expect(all).toContain(squash("Diğer: Airbnb"));
    expect(all).toContain(squash("6 Sample Mews, Bristol"));
  });

  it("answering 'Hayır' (no) to Yes/No questions does not leave the related rows empty (address change, employment, accommodation)", async () => {
    const form: FormData = {
      ...minimalSampleForm,
      contact: { ...minimalSampleForm.contact, addressChangedLastTwoYears: "no" },
      employment: { ...minimalSampleForm.employment, isEmployed: "no" },
      travel: { ...minimalSampleForm.travel, hasAccommodation: "no" },
    };
    const { all } = await generate(pruneFormData(form), "ornek-form-hayir.pdf");
    expect(all).toContain(squash("Son iki yılda adres değişikliği yapılmadı."));
    expect(all).toContain(squash("Çalışmıyor"));
    expect(all).toContain(squash("Henüz ayarlanmadı"));
  });

  it("if the sponsor's employment status is 'Diğer', it is written with its explanation", async () => {
    const form: FormData = {
      ...minimalSampleForm,
      employment: {
        ...minimalSampleForm.employment,
        hasExpenseSponsor: "yes",
        expenseSponsor: { firstName: "Test", lastName: "Sponsor", address: "Test Sokak No: 2", employmentStatus: "other", employmentStatusOther: "Serbest çalışan" },
      },
    };
    const { all } = await generate(form, "ornek-form-sponsor.pdf");
    expect(all).toContain(squash("Evet – iş durumu: Diğer: Serbest çalışan"));
  });

  it("long text that does not fit a cell is not cut; all of it is written to the appendix page", async () => {
    const longAddress =
      "Çok Uzun Mahalle Adı Mahallesi, Fevkalade Uzun Bir Cadde İsmi Caddesi, Yine Uzun Bir Sokak Sokağı, " +
      "Bina Adı Apartmanı A Blok No: 123 Kat: 12 Daire: 48, Posta Kodu 34000, Örnek İlçesi, Örnek Şehri, Türkiye " +
      "(kapı zili bozuk olduğu için lütfen telefonla arayınız, bina girişi arka sokaktandır) SONISARET";
    const form: FormData = {
      ...fullSampleForm,
      travel: { ...fullSampleForm.travel, business: { ...(fullSampleForm.travel!.business as object), address: longAddress } },
    };
    const { result, text } = await generate(form, "ornek-form-tasma.pdf");
    const entry = result.overflow.find((o) => o.label === "Ticari – adres");
    expect(entry).toBeDefined();
    expect(entry!.text).toBe(longAddress);
    const appendix = squash(text.pages.slice(UK_INFO_FORM_PAGE_COUNT).join("\n"));
    expect(appendix).toContain(squash(longAddress));
    expect(squash(text.pages[1]!)).toContain(squash(`Bkz. Ek (${entry!.number})`));
  });

  it("characters missing from the font do not break the output", async () => {
    const form: FormData = { ...minimalSampleForm, additional: { notes: "Not 😀 satır1\nsatır2\tsekme" } };
    const { all } = await generate(form, "ornek-form-karakter.pdf");
    expect(all).toContain("satır1");
    expect(all).toContain("satır2");
  });
});
