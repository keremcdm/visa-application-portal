import {
  GENDER_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  NO,
  SPONSOR_EMPLOYMENT_STATUS_OPTIONS,
  TRAVEL_PURPOSE_OPTIONS,
  YES,
} from "@/features/application-form/definition";
import type { FormData } from "@/features/application-form/types";
import { countryName } from "@/lib/domain/countries";
import { formatDateTr, formatMoneyTr, formatMonthTr, parseMoney } from "@/lib/validation/formats";
import type { Mask, Placement } from "../layout-engine";

/**
 * Field mapping of the "İngiltere Vize Formunun Doldurulması İçin Gereken Bilgiler" (information needed to fill in the UK visa form) template.
 * Template file: assets/form-templates/uk-information-form.pdf (A4, 5 pages, flat PDF).
 *
 * Coordinates come from the `npm run pdf:inspect` output (PDF points, bottom-left origin).
 * The template is a single table: the left column is the question, the right column (x = 219.2 … 557.8) the answer.
 *
 * IMPORTANT: this function must always be given data cleaned with `pruneFormData`;
 * that way old answers of hidden conditional fields never reach the output.
 */

export const UK_INFO_FORM_TEMPLATE_FILE = "uk-information-form.pdf";
export const UK_INFO_FORM_PAGE_COUNT = 5;

/** x positions where text starts and may end in the right column. */
const RX = 224.88;
const RIGHT_EDGE = 553;
/** For short answers written into free space in the left (question) column. */
const LX = 36;
const LEFT_EDGE = 215;

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Obj) : {};
}
function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function list(value: unknown): Obj[] {
  return Array.isArray(value) ? value.map(obj) : [];
}
function optionLabel(options: ReadonlyArray<{ value: string; label: string }>, value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}
function yesNo(value: string): string {
  return value === YES ? "Evet" : value === NO ? "Hayır" : "";
}
function yesNoUpper(value: string): string {
  return value === YES ? "EVET" : value === NO ? "HAYIR" : "";
}
function date(value: string): string {
  return value ? formatDateTr(value) : "";
}
function month(value: string): string {
  return value ? formatMonthTr(value) : "";
}
function money(value: string): string {
  if (!value) return "";
  const parsed = parseMoney(value);
  return parsed === null ? value : `${formatMoneyTr(parsed)} TL`;
}
/** Stored in the form as the country's alpha-3 code; only the country's name is written to the output. */
function country(code: string): string {
  return code ? countryName(code) : "";
}
function joinNonEmpty(parts: string[], separator: string): string {
  return parts.filter((p) => p !== "").join(separator);
}
/** A single string in the form "Evet – details" / "Hayır". */
function yesNoWith(flag: string, detail: string): string {
  if (flag === YES) return detail ? `Evet – ${detail}` : "Evet";
  return yesNo(flag);
}

/** For mother/father, a single string in the form "Evet" / "Hayır – previous: A, B". */
function sameNationality(parent: Obj): string {
  const flag = str(parent.alwaysSameNationality);
  if (flag !== NO) return yesNo(flag);
  const previous = joinNonEmpty(list(parent.previousNationalities).map((item) => country(str(item.nationality))), ", ");
  return previous ? `Hayır – önceki: ${previous}` : "Hayır";
}

/** White rectangle covering the template's 12pt hint text. */
function hintMask(x: number, baseline: number, xEnd: number): Mask {
  return { x, y: baseline - 3.2, width: xEnd - x, height: 12.6 };
}

export type TemplateBuild = {
  placements: Placement[];
  /** Repeated entries beyond the number of rows in the template (written to the appendix page). */
  extraEntries: { label: string; text: string }[];
};

export function buildUkInfoFormPlacements(formData: FormData): TemplateBuild {
  const placements: Placement[] = [];
  const extraEntries: { label: string; text: string }[] = [];

  /** Single-line field: fixed baseline, the point size shrinks if it does not fit. */
  const line = (
    id: string,
    label: string,
    page: number,
    x: number,
    baseline: number,
    text: string,
    opts: { width?: number; bold?: boolean; masks?: Mask[]; size?: number } = {},
  ) => {
    placements.push({
      id,
      label,
      page,
      x,
      width: opts.width ?? RIGHT_EDGE - x,
      firstBaseline: baseline,
      bottom: baseline - 3,
      text,
      bold: opts.bold,
      masks: opts.masks,
      size: opts.size,
    });
  };

  /** Multi-line field: flows down to the `bottom` limit. */
  const box = (
    id: string,
    label: string,
    page: number,
    firstBaseline: number,
    bottom: number,
    text: string,
    opts: { x?: number; width?: number; indent?: number } = {},
  ) => {
    const x = opts.x ?? RX;
    placements.push({
      id,
      label,
      page,
      x,
      width: opts.width ?? RIGHT_EDGE - x,
      firstBaseline,
      bottom,
      indent: opts.indent,
      text,
    });
  };

  /** Single line in the right column aligned with the label's baseline. */
  const cell = (id: string, label: string, page: number, baseline: number, text: string) =>
    line(id, label, page, RX, baseline, text);

  /** Marking an option. */
  const mark = (id: string, label: string, page: number, x: number, baseline: number) =>
    line(id, label, page, x, baseline, "X", { bold: true, size: 11, width: 12 });

  /** Short answer in the free space of the left column. */
  const leftNote = (id: string, label: string, page: number, x: number, baseline: number, text: string, size = 9.5) =>
    line(id, label, page, x, baseline, text, { bold: true, width: LEFT_EDGE - x, size });

  const personal = obj(formData.personal);
  const contact = obj(formData.contact);
  const passport = obj(formData.passport);
  const employment = obj(formData.employment);
  const travel = obj(formData.travel);
  const family = obj(formData.family);
  const history = obj(formData.history);
  const security = obj(formData.security);
  const additional = obj(formData.additional);

  // ======================= PAGE 1 =======================
  cell("personal.firstName", "Adınız", 0, 618.12, str(personal.firstName));
  cell("personal.lastName", "Soyadınız", 0, 596.88, str(personal.lastName));
  cell("personal.maidenName", "Kızlık soyadınız", 0, 575.7, str(personal.maidenName));
  box("contact.homeAddress", "Ev adresiniz", 0, 554.52, 525, str(contact.homeAddress));
  box("contact.residenceDuration", "Ne kadar zamandır bu adreste oturuyorsunuz", 0, 512.64, 499, str(contact.residenceDuration));

  const previousAddresses = list(contact.previousAddresses);
  // A "Hayır" (no) answer is written too, so rows are not left empty and mistaken for missing.
  if (str(contact.addressChangedLastTwoYears) === NO) {
    box("contact.addressChangedLastTwoYears", "Son iki yılda adres değişikliği", 0, 485.94, 467.84, "Son iki yılda adres değişikliği yapılmadı.", { indent: 36 });
  }
  const addressSlots = [
    { address: 485.94, dates: 458.34, endX: 437 },
    { address: 430.74, dates: 403.14, endX: 440 },
  ];
  addressSlots.forEach((slot, i) => {
    const item = previousAddresses[i];
    if (!item) return;
    const n = i + 1;
    box(`contact.previousAddresses.${i}.address`, `Önceki adres ${n}`, 0, slot.address, slot.dates + 9.5, str(item.address), {
      indent: 36,
    });
    line(`contact.previousAddresses.${i}.startDate`, `Önceki adres ${n} – başlangıç`, 0, 311, slot.dates, month(str(item.startDate)), {
      width: 64,
    });
    line(`contact.previousAddresses.${i}.endDate`, `Önceki adres ${n} – bitiş`, 0, slot.endX, slot.dates, month(str(item.endDate)));
  });

  const ownership = str(contact.homeOwnership);
  if (ownership === "owned") mark("contact.homeOwnership", "Oturduğunuz ev: Bana ait", 0, 271, 388.8);
  if (ownership === "rented") mark("contact.homeOwnership", "Oturduğunuz ev: Kira", 0, 253, 375.0);
  if (ownership === "family") mark("contact.homeOwnership", "Oturduğunuz ev: Ailemle yaşamaktayım", 0, 350, 361.2);

  cell("contact.mobilePhone", "Cep telefonu", 0, 347.82, str(contact.mobilePhone));
  cell("contact.email", "E-posta adresi", 0, 326.64, str(contact.email));
  cell("personal.gender", "Cinsiyet", 0, 305.4, optionLabel(GENDER_OPTIONS, str(personal.gender)));
  cell("personal.maritalStatus", "Medeni durum", 0, 284.22, optionLabel(MARITAL_STATUS_OPTIONS, str(personal.maritalStatus)));
  cell("personal.nationality", "Milliyet", 0, 263.04, country(str(personal.nationality)));
  cell("personal.birthDate", "Doğum tarihi", 0, 241.86, date(str(personal.birthDate)));
  box("personal.birthPlace", "Doğum yeri", 0, 220.62, 207, str(personal.birthPlace));
  cell("personal.tcNo", "T.C. kimlik numarası", 0, 194.82, str(personal.tcNo));
  cell("passport.passportNo", "Pasaport no", 0, 173.64, str(passport.passportNo));
  cell("passport.issuingAuthority", "Pasaportu veren makam", 0, 152.46, str(passport.issuingAuthority));
  cell("passport.issueDate", "Pasaport veriliş tarihi", 0, 131.22, date(str(passport.issueDate)));
  cell("passport.expiryDate", "Pasaport geçerlilik tarihi", 0, 110.04, date(str(passport.expiryDate)));

  const otherPassport = obj(passport.otherPassport);
  if (str(passport.hasOtherPassport) === YES) {
    line("passport.otherPassport.country", "Diğer pasaport – ülke", 0, 255, 87.96, country(str(otherPassport.country)));
    line("passport.otherPassport.passportNo", "Diğer pasaport – numara", 0, 291, 67.26, str(otherPassport.passportNo));
    line("passport.otherPassport.placeOfIssue", "Diğer pasaport – verildiği yer", 0, 347, 46.56, str(otherPassport.placeOfIssue));
    // ======================= PAGE 2 =======================
    line("passport.otherPassport.issueDate", "Diğer pasaport – düzenlenme tarihi", 1, 375, 803.22, date(str(otherPassport.issueDate)));
    line("passport.otherPassport.expiryDate", "Diğer pasaport – bitiş tarihi", 1, 328, 782.52, date(str(otherPassport.expiryDate)));
  } else if (str(passport.hasOtherPassport) === NO) {
    line("passport.hasOtherPassport", "Başka ülke pasaportu", 0, 255, 87.96, "Yok");
  }

  cell("employment.occupation", "Meslek / unvan", 1, 741.0, str(employment.occupation));
  cell("employment.workplaceName", "İşyeri adı", 1, 719.82, str(employment.isEmployed) === NO ? "Çalışmıyor" : str(employment.workplaceName));
  box("employment.workplaceAddress", "İşyeri adresi", 1, 700.4, 688.6, str(employment.workplaceAddress));
  cell("employment.workplacePhone", "İşyeri telefonu", 1, 677.4, str(employment.workplacePhone));
  cell("employment.employmentStartDate", "İşe giriş tarihi", 1, 656.22, month(str(employment.employmentStartDate)));
  cell("employment.monthlyNetIncome", "Aylık net kazanç", 1, 630.42, money(str(employment.monthlyNetIncome)));
  cell("employment.monthlyExpenses", "Türkiye'deki aylık gider", 1, 609.24, money(str(employment.monthlyExpenses)));
  // The template has no separate row for the sponsor's employment status; it is written next to the Yes/No answer.
  const sponsorInfo = obj(employment.expenseSponsor);
  const sponsorStatus = str(sponsorInfo.employmentStatus);
  const sponsorStatusText =
    sponsorStatus === "other"
      ? joinNonEmpty(["Diğer", str(sponsorInfo.employmentStatusOther)], ": ")
      : sponsorStatus
        ? optionLabel(SPONSOR_EMPLOYMENT_STATUS_OPTIONS, sponsorStatus)
        : "";
  cell(
    "employment.hasExpenseSponsor",
    "Masrafları karşılayacak kimse var mı (evet ise iş durumu)",
    1,
    583.44,
    yesNoWith(str(employment.hasExpenseSponsor), sponsorStatusText ? `iş durumu: ${sponsorStatusText}` : ""),
  );
  cell(
    "travel.dates",
    "Tahmini gidiş – dönüş tarihi",
    1,
    557.64,
    joinNonEmpty([date(str(travel.departureDate)), date(str(travel.returnDate))], " – "),
  );
  const purpose = str(travel.purpose);
  cell(
    "travel.purpose",
    "Gidiş amacı",
    1,
    536.4,
    purpose === "other" ? joinNonEmpty(["Diğer", str(travel.purposeOther)], ": ") : optionLabel(TRAVEL_PURPOSE_OPTIONS, purpose),
  );

  const business = obj(travel.business);
  line("travel.business.companyName", "Ticari – şirket/kongre adı", 1, 402, 498.06, str(business.companyName));
  line("travel.business.activityField", "Ticari – faaliyet alanı", 1, 294, 479.04, str(business.activityField));
  line("travel.business.address", "Ticari – adres", 1, 264, 460.08, str(business.address));
  line("travel.business.phone", "Ticari – telefon", 1, 309, 422.16, str(business.phone));
  line("travel.business.email", "Ticari – e-posta", 1, 291, 403.14, str(business.email));
  line("travel.business.inviterName", "Ticari – davetiyeyi gönderen", 1, 417, 384.18, str(business.inviterName));

  const spouse = obj(family.spouse);
  line("family.spouse.firstName", "Eş – adı", 1, 248, 364.74, str(spouse.firstName));
  line("family.spouse.lastName", "Eş – soyadı", 1, 262, 345.72, str(spouse.lastName));
  cell("family.spouse.birthDate", "Eş – doğum tarihi", 1, 326.22, date(str(spouse.birthDate)));
  cell("family.spouse.nationality", "Eş – milliyeti", 1, 306.72, country(str(spouse.nationality)));
  box(
    "family.spouse.livesWithApplicant",
    "Eşiniz sizinle birlikte mi yaşıyor (hayır ise adresi)",
    1,
    288.4,
    273.4,
    str(spouse.livesWithApplicant) === NO ? joinNonEmpty(["Hayır", str(spouse.address)], " – ") : yesNo(str(spouse.livesWithApplicant)),
  );
  line(
    "family.spouse.travelsWithApplicant",
    "Eşiniz sizinle seyahat edecek mi (evet ise pasaport no)",
    1,
    326,
    260.58,
    yesNoWith(str(spouse.travelsWithApplicant), str(spouse.passportNo)),
  );

  // Children: the template has room for two entries. The hint text in the last two rows
  // ("Hayır ise adresi", "(Evet ise milliyeti ve pasaport no)") is covered to make room for the answer.
  const children = list(family.children);
  const childSlots = [
    { name: 234.6, birth: 217.74, lives: 200.88, travels: 184.08 },
    { name: 150.36, birth: 133.5, lives: 116.7, travels: 99.84 },
  ];
  const childLives = (c: Obj) =>
    str(c.livesWithApplicant) === NO ? joinNonEmpty(["Hayır", str(c.address)], " – ") : yesNo(str(c.livesWithApplicant));
  const childTravels = (c: Obj) =>
    str(c.travelsWithApplicant) === YES
      ? joinNonEmpty(["Evet", country(str(c.nationality)), str(c.passportNo)], " – ")
      : yesNo(str(c.travelsWithApplicant));
  children.forEach((child, i) => {
    const slot = childSlots[i];
    const n = i + 1;
    if (!slot) {
      extraEntries.push({
        label: `Bakmakla yükümlü olunan kişi ${n}`,
        text: [
          `Adı soyadı: ${str(child.fullName)}`,
          `Doğum tarihi: ${date(str(child.birthDate))}`,
          `Şu an sizinle birlikte mi yaşıyor: ${childLives(child)}`,
          `Sizinle birlikte seyahat edecek mi: ${childTravels(child)}`,
        ].join("\n"),
      });
      return;
    }
    line(`family.children.${i}.fullName`, `Çocuk ${n} – adı soyadı`, 1, 283, slot.name, str(child.fullName));
    line(`family.children.${i}.birthDate`, `Çocuk ${n} – doğum tarihi`, 1, 296, slot.birth, date(str(child.birthDate)));
    line(`family.children.${i}.livesWithApplicant`, `Çocuk ${n} – sizinle mi yaşıyor (hayır ise adresi)`, 1, 385, slot.lives, childLives(child), {
      masks: [hintMask(380.8, slot.lives, 457)],
    });
    line(`family.children.${i}.travelsWithApplicant`, `Çocuk ${n} – sizinle seyahat edecek mi (milliyet, pasaport no)`, 1, 392, slot.travels, childTravels(child), {
      masks: [hintMask(388.6, slot.travels, 552)],
    });
  });
  if (str(family.hasDependents) === NO) {
    line("family.hasDependents", "Bakmakla yükümlü olunan kişi", 1, 283, 234.6, "Yok");
  }
  if (children.length > childSlots.length) {
    leftNote("family.children.more", "Diğer çocuklar", 1, LX, 170, `Toplam ${children.length} kişi – diğerleri ek sayfada`, 7.5);
  }

  const mother = obj(family.mother);
  line("family.mother.firstName", "Anne – adı", 1, 248, 82.5, str(mother.firstName));
  line("family.mother.lastName", "Anne – soyadı", 1, 264, 60.48, str(mother.lastName));

  // ======================= PAGE 3 =======================
  cell("family.mother.birthDate", "Anne – doğum tarihi", 2, 804.12, date(str(mother.birthDate)));
  cell("family.mother.nationality", "Anne – milliyeti", 2, 781.62, country(str(mother.nationality)));
  cell("family.mother.alwaysSameNationality", "Anne – her zaman aynı uyruk (hayır ise önceki uyrukları)", 2, 759.18, sameNationality(mother));

  const father = obj(family.father);
  line("family.father.firstName", "Baba – adı", 2, 248, 719.64, str(father.firstName));
  line("family.father.lastName", "Baba – soyadı", 2, 264, 705.0, str(father.lastName));
  cell("family.father.birthDate", "Baba – doğum tarihi", 2, 690.9, date(str(father.birthDate)));
  cell("family.father.nationality", "Baba – milliyeti", 2, 668.46, country(str(father.nationality)));
  cell("family.father.alwaysSameNationality", "Baba – her zaman aynı uyruk (hayır ise önceki uyrukları)", 2, 645.96, sameNationality(father));

  const relative = obj(family.ukRelative);
  leftNote("family.hasUkRelative", "İngiltere'de yaşayan akraba var mı", 2, 153, 588.54, yesNoUpper(str(family.hasUkRelative)));
  line("family.ukRelative.fullName", "İngiltere'deki akraba – adı soyadı", 2, 280, 607.56, str(relative.fullName));
  line("family.ukRelative.relationship", "İngiltere'deki akraba – yakınlık", 2, 309, 588.6, str(relative.relationship));
  line("family.ukRelative.nationality", "İngiltere'deki akraba – uyruğu", 2, 265, 569.64, country(str(relative.nationality)));
  line("family.ukRelative.status", "İngiltere'deki akraba – statüsü", 2, 430, 550.68, str(relative.status));
  line("family.ukRelative.passportNo", "İngiltere'deki akraba – pasaport no", 2, 283, 531.66, str(relative.passportNo));
  leftNote("family.ukRelative.staysWithRelative", "Akrabanın evinde mi kalınacak", 2, LX, 436.3, yesNoUpper(str(relative.staysWithRelative)));
  line("family.ukRelative.email", "İngiltere'deki akraba – e-posta", 2, 291, 474.24, str(relative.email));
  line("family.ukRelative.address", "İngiltere'deki akraba – adres", 2, 261, 455.28, str(relative.address));

  // The template only has hotel rows. If staying with someone, a short note goes in the hotel name row
  // and the person's details are written to the appendix page. "Diğer" (other) accommodation (e.g. Airbnb) goes in the hotel rows.
  const hotel = obj(travel.hotel);
  const accommodationType = str(travel.accommodationType);
  if (accommodationType === "host") {
    const host = obj(travel.host);
    line("travel.accommodationType", "Konaklama", 2, 248, 416.82, "Biriyle kalacak – bilgiler ek sayfada");
    extraEntries.push({
      label: "Konaklama – yanında kalınacak kişi",
      text: [
        `Adı: ${str(host.firstName)}`,
        `Soyadı: ${str(host.lastName)}`,
        `Adresi: ${str(host.address)}`,
        `E-posta adresi: ${str(host.email)}`,
        `Telefon numarası: ${str(host.phone)}`,
      ].join("\n"),
    });
  } else if (accommodationType === "other") {
    const other = obj(travel.otherAccommodation);
    line("travel.otherAccommodation.place", "Konaklama – yeri", 2, 248, 416.82, joinNonEmpty(["Diğer", str(other.place)], ": "));
    line("travel.otherAccommodation.address", "Konaklama – adresi", 2, 261, 397.86, str(other.address));
  } else if (str(travel.hasAccommodation) === NO) {
    line("travel.hasAccommodation", "Konaklama", 2, 248, 416.82, "Henüz ayarlanmadı");
  } else {
    line("travel.hotel.name", "Otel – adı", 2, 248, 416.82, str(hotel.name));
    line("travel.hotel.address", "Otel – adresi", 2, 261, 397.86, str(hotel.address));
  }

  // The form only asks for one travel companion (spouse and children are in the Family section).
  const companion = obj(travel.companion);
  if (str(travel.hasCompanions) === YES) {
    line("travel.companion.firstName", "Birlikte seyahat edilen – adı", 2, 246, 359.16, str(companion.firstName));
    line("travel.companion.lastName", "Birlikte seyahat edilen – soyadı", 2, 261, 339.06, str(companion.lastName));
    // The template has no separate row for the passport number; it is appended to the nationality row.
    const companionPassport = str(companion.passportNo);
    line(
      "travel.companion.nationality",
      "Birlikte seyahat edilen – uyruğu ve pasaport no",
      2,
      267,
      318.9,
      joinNonEmpty([country(str(companion.nationality)), companionPassport ? `Pasaport no: ${companionPassport}` : ""], " – "),
    );
    line("travel.companion.relationship", "Birlikte seyahat edilen – yakınlık", 2, 306, 298.74, str(companion.relationship));
  } else if (str(travel.hasCompanions) === NO) {
    leftNote("travel.hasCompanions", "Kiminle seyahat edilecek", 2, LX, 318.9, "YALNIZ");
  }
  // The template has no row for the group; it is written to the appendix page.
  if (str(travel.travelsWithGroup) === YES) {
    extraEntries.push({ label: "Grupla seyahat", text: `Grubun adı: ${str(travel.groupName)}` });
  }

  box("employment.otherIncome", "Başka gelir", 2, 278.28, 252.6, yesNoWith(str(employment.hasOtherIncome), str(employment.otherIncomeDetails)));
  box("employment.savings", "Birikimler ve kaynakları", 2, 238.6, 176.2, yesNoWith(str(employment.hasSavings), str(employment.savingsDetails)));

  const sponsor = obj(employment.expenseSponsor);
  line("employment.expenseSponsor.firstName", "Masrafları karşılayan – adı", 2, 250, 162.54, str(sponsor.firstName));
  line("employment.expenseSponsor.lastName", "Masrafları karşılayan – soyadı", 2, 265, 148.74, str(sponsor.lastName));
  box("employment.expenseSponsor.address", "Masrafları karşılayan – adresi", 2, 134.94, 120.4, str(sponsor.address), { indent: 39 });

  line("history.hadUkVisaLast10Years", "Son 10 yılda İngiltere vizesi", 2, RX, 103.5, yesNoUpper(str(history.hadUkVisaLast10Years)), { bold: true });
  line("history.ukVisaIssueDate", "İngiltere vizesi veriliş tarihi", 2, 330, 84.72, date(str(history.ukVisaIssueDate)));

  // ======================= PAGE 4 =======================
  const medical = obj(history.ukMedicalTreatment);
  leftNote("history.hadUkMedicalTreatment", "İngiltere'de tıbbi tedavi", 3, 104, 766.14, yesNoUpper(str(history.hadUkMedicalTreatment)));
  line("history.ukMedicalTreatment.paid", "Tıbbi tedavi – ödeme yapıldı mı", 3, 333, 803.04, yesNo(str(medical.paid)));
  box("history.ukMedicalTreatment.address", "Tıbbi tedavi – açık adres", 3, 781.02, 748.6, str(medical.address), { indent: 67.5 });
  line(
    "history.ukMedicalTreatment.dates",
    "Tıbbi tedavi – giriş çıkış tarihi",
    3,
    320,
    737.1,
    joinNonEmpty([date(str(medical.entryDate)), date(str(medical.exitDate))], " – "),
  );
  line("history.ukMedicalTreatment.stillReceiving", "Tıbbi tedavi – devam ediyor mu", 3, 421, 693.18, yesNo(str(medical.stillReceiving)));

  const ukVisitMarks: Record<string, [number, number]> = {
    none: [246, 649.62],
    once: [454, 629.46],
    "2-5": [458, 609.3],
    "6+": [498, 589.2],
  };
  const ukMark = ukVisitMarks[str(history.ukVisitCount)];
  if (ukMark) mark("history.ukVisitCount", "Son 10 yılda İngiltere'ye gidiş sayısı", 3, ukMark[0], ukMark[1]);

  const ukVisits = list(history.ukVisits);
  const ukRows = [
    [568.56, 548.4, 528.24],
    [507.6, 487.5, 467.34],
    [446.7, 426.54, 406.44],
  ] as const;
  ukVisits.forEach((visit, i) => {
    const n = i + 1;
    const row = ukRows[Math.floor(i / 2)];
    if (!row) {
      extraEntries.push({
        label: `İngiltere seyahati ${n}`,
        text: [
          `Gidiş tarihi (ay-yıl): ${month(str(visit.date))}`,
          `Kalış süresi: ${str(visit.duration)}`,
          `Gidiş amacı: ${str(visit.purpose)}`,
        ].join("\n"),
      });
      return;
    }
    const right = i % 2 === 1;
    line(`history.ukVisits.${i}.date`, `İngiltere seyahati ${n} – gidiş tarihi`, 3, right ? 481 : 320, row[0], month(str(visit.date)), {
      width: right ? 72 : 62,
    });
    line(`history.ukVisits.${i}.duration`, `İngiltere seyahati ${n} – kalış süresi`, 3, right ? 451 : 289, row[1], str(visit.duration), {
      width: right ? 102 : 94,
    });
    line(`history.ukVisits.${i}.purpose`, `İngiltere seyahati ${n} – gidiş amacı`, 3, right ? 461 : 298, row[2], str(visit.purpose), {
      width: right ? 92 : 86,
    });
  });

  cell(
    "history.hasUkNationalInsuranceNumber",
    "Birleşik Krallık Ulusal Sigorta numarası",
    3,
    385.98,
    yesNoWith(str(history.hasUkNationalInsuranceNumber), str(history.ukNationalInsuranceNumber)),
  );
  cell("history.receivedUkPublicFunds", "Birleşik Krallık'ta kamu fonu", 3, 347.52, yesNo(str(history.receivedUkPublicFunds)));
  cell("history.appliedUkLeaveToRemain", "Birleşik Krallık'ta oturum izni başvurusu", 3, 309.06, yesNo(str(history.appliedUkLeaveToRemain)));
  const leave = obj(history.leaveToRemain);
  cell("history.leaveToRemain.applicationDate", "Oturum izni – başvuru tarihi", 3, 213.72, date(str(leave.applicationDate)));
  cell("history.leaveToRemain.result", "Oturum izni – sonuç", 3, 194.7, str(leave.result));

  const otherMarks: Record<string, [number, number]> = {
    none: [246, 127.56],
    once: [461, 114.18],
    "2-5": [463, 100.74],
    "6+": [503, 87.3],
  };
  const otherMark = otherMarks[str(history.otherCountriesVisitCount)];
  if (otherMark) mark("history.otherCountriesVisitCount", "Belirtilen ülkelere gidiş sayısı", 3, otherMark[0], otherMark[1]);

  const otherVisits = list(history.otherCountriesVisits);
  otherVisits.forEach((visit, i) => {
    const n = i + 1;
    if (i >= 2) {
      extraEntries.push({
        label: `Avustralya / Kanada / Yeni Zelanda / ABD / Schengen seyahati ${n}`,
        text: [
          `Hangi ülke: ${country(str(visit.country))}`,
          `Gidiş tarihi (ay-yıl): ${month(str(visit.date))}`,
          `Kalış süresi: ${str(visit.duration)}`,
          `Gidiş amacı: ${str(visit.purpose)}`,
        ].join("\n"),
      });
      return;
    }
    const right = i === 1;
    line(`history.otherCountriesVisits.${i}.country`, `Belirtilen ülke seyahati ${n} – ülke`, 3, right ? 428 : 278, 52.74, country(str(visit.country)), {
      width: right ? 125 : 93,
    });
    // ======================= PAGE 5 =======================
    line(`history.otherCountriesVisits.${i}.date`, `Belirtilen ülke seyahati ${n} – gidiş tarihi`, 4, right ? 463 : 320, 803.94, month(str(visit.date)), {
      width: right ? 90 : 50,
    });
    line(`history.otherCountriesVisits.${i}.duration`, `Belirtilen ülke seyahati ${n} – kalış süresi`, 4, right ? 439 : 289, 783.78, str(visit.duration), {
      width: right ? 114 : 82,
    });
    line(`history.otherCountriesVisits.${i}.purpose`, `Belirtilen ülke seyahati ${n} – gidiş amacı`, 4, right ? 449 : 298, 763.62, str(visit.purpose), {
      width: right ? 104 : 74,
    });
  });

  const elsewhere = list(history.elsewhereVisits);
  const elsewhereBlocks = [
    { country: 742.98, departure: 722.88, ret: 702.72, purpose: 682.56, rightReturnX: 499 },
    { country: 662.4, departure: 642.3, ret: 622.14, purpose: 601.98, rightReturnX: 499 },
    { country: 561.72, departure: 541.56, ret: 521.45, purpose: 501.29, rightReturnX: 504 },
  ];
  elsewhere.forEach((visit, i) => {
    const n = i + 1;
    const block = elsewhereBlocks[Math.floor(i / 2)];
    if (!block) {
      extraEntries.push({
        label: `Diğer ülke seyahati ${n}`,
        text: [
          `Hangi ülke: ${country(str(visit.country))}`,
          `Gidiş tarihi: ${date(str(visit.departureDate))}`,
          `Dönüş tarihi: ${date(str(visit.returnDate))}`,
          `Gidiş amacı: ${str(visit.purpose)}`,
        ].join("\n"),
      });
      return;
    }
    const right = i % 2 === 1;
    line(`history.elsewhereVisits.${i}.country`, `Diğer ülke seyahati ${n} – ülke`, 4, right ? 428 : 278, block.country, country(str(visit.country)), {
      width: right ? 125 : 93,
    });
    line(`history.elsewhereVisits.${i}.departureDate`, `Diğer ülke seyahati ${n} – gidiş tarihi`, 4, right ? 493 : 336, block.departure, date(str(visit.departureDate)), {
      width: right ? 60 : 50,
    });
    if (right) {
      line(`history.elsewhereVisits.${i}.returnDate`, `Diğer ülke seyahati ${n} – dönüş tarihi`, 4, block.rightReturnX, block.ret, date(str(visit.returnDate)), {
        width: RIGHT_EDGE - block.rightReturnX,
      });
    } else {
      // In the left column there is no room for the date unless the "( gg- ay-yıl ):" hint is covered.
      line(`history.elsewhereVisits.${i}.returnDate`, `Diğer ülke seyahati ${n} – dönüş tarihi`, 4, 297, block.ret, date(str(visit.returnDate)), {
        width: 85,
        masks: [{ x: 293.6, y: block.ret - 3, width: 57, height: 12 }],
      });
    }
    line(`history.elsewhereVisits.${i}.purpose`, `Diğer ülke seyahati ${n} – gidiş amacı`, 4, right ? 449 : 298, block.purpose, str(visit.purpose), {
      width: right ? 104 : 74,
    });
  });
  if (str(history.visitedElsewhere) === NO) {
    line("history.visitedElsewhere", "Diğer ülkelere seyahat", 4, 278, 742.98, "Yok", { width: 93 });
  }

  // Number, dates and reasons of refusals are in the customer's explanation (not separate fields in the form).
  box("security.ukRefusal", "Birleşik Krallık ret / sınır dışı geçmişi", 4, 480.66, 430, yesNoWith(str(security.ukRefusal), str(security.ukRefusalDetails)), {
    indent: 94,
  });
  line("security.otherRefusal", "Diğer ülkelerde ret / sınır dışı geçmişi", 4, 319, 416.94, yesNo(str(security.otherRefusal)));
  box("security.otherRefusalDetails", "Diğer ülkelerde ret / sınır dışı – açıklama", 4, 389, 291, str(security.otherRefusalDetails));
  box("additional.notes", "Özel olarak belirtilmek istenen durum", 4, 276, 146, str(additional.notes));

  return { placements, extraEntries };
}
