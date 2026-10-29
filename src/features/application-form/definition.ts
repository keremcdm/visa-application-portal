import { COUNTRY_OPTIONS } from "@/lib/domain/countries";
import type { DateBound, Field, FieldOption, RepeatField, Section, SectionId } from "./types";

/**
 * APPLICATION FORM DEFINITION
 *
 * The fields match the company's "İngiltere Vize Formunun Doldurulması İçin Gereken Bilgiler" (information needed to fill in
 * the UK visa form) template and the field list in the project requirements one-to-one.
 *
 * The `required` flags are an initial assumption; they can be changed in this file with the company's approval.
 */

export const YES = "yes";
export const NO = "no";

/*
 * ORDER OF SELECT OPTIONS
 * Options are sorted by the Turkish alphabet. There are two exceptions:
 *   - lists whose order carries a numeric meaning (e.g. VISIT_COUNT_OPTIONS) keep their own order;
 *   - a catch-all option such as "Diğer" (other) stays at the end of the list.
 * The order is given by hand in this file (so it is identical on server and browser); tests/form/engine.test.ts verifies it.
 */

export const GENDER_OPTIONS: readonly FieldOption[] = [
  { value: "male", label: "Erkek" },
  { value: "female", label: "Kadın" },
];

export const MARITAL_STATUS_OPTIONS: readonly FieldOption[] = [
  { value: "single", label: "Bekar" },
  { value: "divorced", label: "Boşanmış" },
  { value: "widowed", label: "Dul" },
  { value: "married", label: "Evli" },
];

export const HOME_OWNERSHIP_OPTIONS: readonly FieldOption[] = [
  { value: "family", label: "Ailemle yaşamaktayım" },
  { value: "owned", label: "Bana ait" },
  { value: "rented", label: "Kira" },
];

export const TRAVEL_PURPOSE_OPTIONS: readonly FieldOption[] = [
  { value: "family_visit", label: "Aile Ziyareti" },
  { value: "education", label: "Eğitim" },
  { value: "business", label: "Ticari" },
  { value: "tourism", label: "Turistik" },
  // The catch-all option stays at the end.
  { value: "other", label: "Diğer" },
];

export const ACCOMMODATION_TYPE_OPTIONS: readonly FieldOption[] = [
  { value: "host", label: "Biriyle kalacağım" },
  { value: "hotel", label: "Otelde kalacağım" },
  // The catch-all option stays at the end.
  { value: "other", label: "Diğer" },
];

/** Values match the application's sponsor status constants (SPONSOR_STATUSES); "other" only exists in the form. */
export const SPONSOR_EMPLOYMENT_STATUS_OPTIONS: readonly FieldOption[] = [
  { value: "employee", label: "Çalışan" },
  { value: "retired", label: "Emekli" },
  { value: "business_owner", label: "İşyeri sahibi" },
  // The catch-all option stays at the end.
  { value: "other", label: "Diğer" },
];

/**
 * List for every field asking for a country or nationality: "Türkiye - TUR" is pinned at the top,
 * the other countries are in Turkish alphabetical order. The alpha-3 code is stored as the value.
 */
export const COUNTRY_SELECT_OPTIONS: readonly FieldOption[] = [
  ...COUNTRY_OPTIONS.filter((option) => option.value === "TUR"),
  ...COUNTRY_OPTIONS.filter((option) => option.value !== "TUR"),
];

/** The same list is used for every field asking for a country or nationality. */
const countryField = (key: string, label: string, required = true): Field => ({
  key,
  label,
  type: "select",
  required,
  options: COUNTRY_SELECT_OPTIONS,
  width: "half",
});

/** The order carries a numeric meaning; not sorted alphabetically. */
export const VISIT_COUNT_OPTIONS: readonly FieldOption[] = [
  { value: "none", label: "Hiç" },
  { value: "once", label: "Bir defa" },
  { value: "2-5", label: "2-5 defa" },
  { value: "6+", label: "6 veya daha fazla" },
];

const VISITED = ["once", "2-5", "6+"] as const;

const EMPLOYED = { path: "isEmployed", equals: YES } as const;

/**
 * DATE RULES.
 * Rules are declarative: validation applies them and the date picker shows days outside the rule as unselectable.
 */
const notBeforeLocal = (key: string, message: string, sameDay = true): DateBound => ({ path: key, sameDay, message });

/** An event date (issue, address, job, trip…) cannot be before the applicant's date of birth. */
const AFTER_BIRTH: DateBound = {
  path: "personal.birthDate",
  scope: "root",
  sameDay: true,
  message: "Bu tarih doğum tarihinizden önce olamaz.",
};

/** Questions asked as "in the last 10 years". */
const LAST_TEN_YEARS = 10;

/**
 * Number of trips to enter based on the answer to "how many times have you been?": "Bir defa" (once) → exactly one trip;
 * for other answers at least one and at most `max` trips.
 */
const visitLimits = (path: string, max: number): RepeatField["countBy"] => ({
  path,
  limits: {
    once: { min: 1, max: 1 },
    "2-5": { min: 1, max },
    "6+": { min: 1, max },
  },
});

const personNameFields = (required: boolean): Field[] => [
  { key: "firstName", label: "Adı", type: "text", required, maxLength: 60, width: "half" },
  { key: "lastName", label: "Soyadı", type: "text", required, maxLength: 60, width: "half" },
];

const parentFields: Field[] = [
  ...personNameFields(true),
  {
    key: "birthDate",
    label: "Doğum tarihi",
    type: "date",
    range: "past",
    required: true,
    width: "half",
    notAfter: [{ path: "personal.birthDate", scope: "root", message: "Anne veya babanızın doğum tarihi sizin doğum tarihinizden önce olmalıdır." }],
  },
  countryField("nationality", "Milliyeti"),
  {
    key: "alwaysSameNationality",
    label: "Her zaman aynı uyruğa mı sahipti?",
    type: "yesno",
    required: true,
  },
  {
    key: "previousNationalities",
    label: "Önceki uyrukları",
    type: "repeat",
    itemLabel: "Uyruk",
    addLabel: "Uyruk ekle",
    min: 1,
    max: 5,
    visibleWhen: { path: "alwaysSameNationality", equals: NO },
    fields: [countryField("nationality", "Önceki uyruğu")],
  },
];

const PASSPORT_NO_PATTERN = { regex: /^[A-Z0-9]{4,20}$/, message: "Pasaport numarası yalnızca harf ve rakam içermelidir." };

const UK_REFUSAL_VISIBLE = { path: "ukRefusal", equals: YES } as const;

export const FORM_SECTIONS: readonly Section[] = [
  {
    id: "personal",
    title: "Kişisel bilgiler",
    fields: [
      { key: "firstName", label: "Adınız", type: "text", required: true, maxLength: 60, autoComplete: "given-name", width: "half" },
      { key: "lastName", label: "Soyadınız", type: "text", required: true, maxLength: 60, autoComplete: "family-name", width: "half" },
      { key: "maidenName", label: "Kızlık soyadınız", type: "text", maxLength: 60, hint: "Yoksa boş bırakınız.", width: "half" },
      { key: "gender", label: "Cinsiyetiniz", type: "select", required: true, options: GENDER_OPTIONS, width: "half" },
      { key: "maritalStatus", label: "Medeni durumunuz", type: "select", required: true, options: MARITAL_STATUS_OPTIONS, width: "half" },
      countryField("nationality", "Milliyetiniz"),
      { key: "birthDate", label: "Doğum tarihiniz", type: "date", range: "past", required: true, width: "half" },
      { key: "birthPlace", label: "Doğum yeriniz (pasaportta yazan)", type: "text", required: true, maxLength: 80, width: "half" },
      {
        key: "tcNo",
        label: "T.C. kimlik numaranız",
        type: "nationalId",
        required: true,
        hint: "11 haneli numaranızı boşluk bırakmadan yazınız.",
        width: "half",
      },
    ],
  },
  {
    id: "contact",
    title: "İletişim ve adres",
    fields: [
      { key: "homeAddress", label: "Ev adresiniz", type: "textarea", required: true, maxLength: 300, rows: 3 },
      {
        key: "residenceDuration",
        label: "Ne kadar zamandır bu adreste oturuyorsunuz?",
        type: "text",
        required: true,
        maxLength: 60,
        hint: "Örneğin: 3 yıl 4 ay",
        width: "half",
      },
      { key: "homeOwnership", label: "Oturduğunuz ev", type: "select", required: true, options: HOME_OWNERSHIP_OPTIONS, width: "half" },
      { key: "mobilePhone", label: "Cep telefonu numaranız", type: "phone", required: true, width: "half" },
      { key: "email", label: "E-posta adresiniz", type: "email", required: true, width: "half" },
      {
        key: "addressChangedLastTwoYears",
        label: "Son iki yılda adres değişikliği yaptınız mı?",
        type: "yesno",
        required: true,
        hint: "Şu an yaşadığınız adreste iki yıldan kısa süredir oturuyorsanız “Evet” seçiniz.",
      },
      {
        key: "previousAddresses",
        label: "Önceki adresleriniz",
        hint: "Şu an oturduğunuz adres hariç, son oturduğunuz en fazla iki adresi giriniz.",
        type: "repeat",
        itemLabel: "Önceki adres",
        addLabel: "Önceki adres ekle",
        min: 1,
        max: 2,
        visibleWhen: { path: "addressChangedLastTwoYears", equals: YES },
        fields: [
          { key: "address", label: "Adres", type: "textarea", required: true, maxLength: 300, rows: 2 },
          { key: "startDate", label: "Başlangıç tarihi (ay-yıl)", type: "month", range: "past", required: true, width: "half", notBefore: [AFTER_BIRTH] },
          {
            key: "endDate",
            label: "Bitiş tarihi (ay-yıl)",
            type: "month",
            range: "past",
            required: true,
            width: "half",
            notBefore: [notBeforeLocal("startDate", "Bitiş tarihi başlangıç tarihinden önce olamaz.")],
          },
        ],
      },
    ],
  },
  {
    id: "passport",
    title: "Pasaport",
    fields: [
      {
        key: "passportNo",
        label: "Pasaport numarası",
        type: "text",
        required: true,
        maxLength: 15,
        uppercase: true,
        compact: true,
        pattern: { regex: /^[A-Z0-9]{5,15}$/, message: "Pasaport numarası 5–15 harf ve rakamdan oluşmalıdır." },
        width: "half",
      },
      { key: "issuingAuthority", label: "Pasaportu veren makam", type: "text", required: true, maxLength: 80, width: "half" },
      { key: "issueDate", label: "Pasaport veriliş tarihi", type: "date", range: "past", required: true, width: "half", notBefore: [AFTER_BIRTH] },
      {
        key: "expiryDate",
        label: "Pasaport geçerlilik tarihi",
        type: "date",
        range: "future",
        rangeMessage: "Pasaportunuzun geçerlilik süresi dolmuş görünüyor. Lütfen geçerli pasaportunuzun bilgilerini giriniz.",
        required: true,
        width: "half",
        notBefore: [notBeforeLocal("issueDate", "Geçerlilik tarihi veriliş tarihinden sonra olmalıdır.", false)],
      },
      {
        key: "hasOtherPassport",
        label: "Türkiye dışında başka bir ülkeden alınmış pasaportunuz veya seyahat belgeniz var mı?",
        type: "yesno",
        required: true,
      },
      {
        key: "otherPassport",
        label: "Diğer pasaport / seyahat belgesi",
        type: "group",
        visibleWhen: { path: "hasOtherPassport", equals: YES },
        fields: [
          countryField("country", "Ülke"),
          {
            key: "passportNo",
            label: "Pasaport numarası",
            type: "text",
            required: true,
            maxLength: 20,
            uppercase: true,
            compact: true,
            pattern: { regex: /^[A-Z0-9]{4,20}$/, message: "Pasaport numarası yalnızca harf ve rakam içermelidir." },
            width: "half",
          },
          { key: "placeOfIssue", label: "Pasaportun verildiği yer", type: "text", required: true, maxLength: 80, width: "half" },
          { key: "issueDate", label: "Düzenlenme tarihi", type: "date", range: "past", required: true, width: "half", notBefore: [AFTER_BIRTH] },
          {
            key: "expiryDate",
            label: "Bitiş tarihi",
            type: "date",
            required: true,
            width: "half",
            notBefore: [notBeforeLocal("issueDate", "Bitiş tarihi düzenlenme tarihinden sonra olmalıdır.", false)],
          },
        ],
      },
    ],
  },
  {
    id: "employment",
    title: "Çalışma ve gelir",
    fields: [
      {
        key: "occupation",
        label: "Mesleğiniz / unvanınız",
        type: "text",
        required: true,
        maxLength: 80,
        hint: "Çalışmıyorsanız durumunuzu yazınız (ör. emekli, öğrenci).",
        width: "half",
      },
      // Workplace details are required for employed applicants. Asked regardless of the
      // application type: e.g. someone applying to visit relatives may also be employed.
      {
        key: "isEmployed",
        label: "Şu anda çalışıyor musunuz?",
        hint: "Bir işyerinde çalışıyorsanız veya kendi işinizin sahibiyseniz “Evet”i seçiniz.",
        type: "yesno",
        required: true,
      },
      { key: "workplaceName", label: "İşyeri adı", type: "text", required: true, maxLength: 120, width: "half", visibleWhen: EMPLOYED },
      { key: "workplacePhone", label: "İşyeri telefon numarası", type: "phone", required: true, width: "half", visibleWhen: EMPLOYED },
      { key: "workplaceAddress", label: "İşyeri adresi", type: "textarea", required: true, maxLength: 300, rows: 2, visibleWhen: EMPLOYED },
      {
        key: "employmentStartDate",
        label: "İşe başlangıç tarihiniz (ay-yıl)",
        type: "month",
        range: "past",
        notBefore: [AFTER_BIRTH],
        required: true,
        hint: "Ay ve yıl yeterlidir.",
        width: "half",
        visibleWhen: EMPLOYED,
      },
      {
        key: "monthlyNetIncome",
        label: "Aylık net kazancınız (TL)",
        type: "money",
        required: true,
        hint: "Geliriniz yoksa 0 yazınız.",
        width: "half",
      },
      { key: "monthlyExpenses", label: "Türkiye'deki aylık gideriniz (TL)", type: "money", required: true, width: "half" },
      { key: "hasOtherIncome", label: "Başka bir geliriniz var mı? (kira vb.)", type: "yesno", required: true },
      {
        key: "otherIncomeDetails",
        label: "Diğer gelirinizin kaynağı ve tutarı",
        type: "textarea",
        required: true,
        maxLength: 300,
        rows: 2,
        visibleWhen: { path: "hasOtherIncome", equals: YES },
      },
      { key: "hasSavings", label: "Birikimleriniz var mı?", type: "yesno", required: true },
      {
        key: "savingsDetails",
        label: "Birikimleriniz ve kaynakları",
        type: "textarea",
        required: true,
        maxLength: 500,
        rows: 3,
        placeholder: "Birikimlerinizi detaylı bir şekilde açıklayınız (altın, gümüş, döviz, borsa, fon, vadeli hesap, kripto hesabı vs.)",
        visibleWhen: { path: "hasSavings", equals: YES },
      },
      {
        key: "hasExpenseSponsor",
        label: "Seyahat masraflarınızı karşılayacak başka biri var mı?",
        type: "yesno",
        required: true,
      },
      {
        key: "expenseSponsor",
        label: "Masrafları karşılayacak kişi",
        hint: "Masraflarınızı aileniz karşılayacaksa ilgili kişinin bilgilerini giriniz.",
        type: "group",
        visibleWhen: { path: "hasExpenseSponsor", equals: YES },
        fields: [
          ...personNameFields(true),
          { key: "address", label: "Adresi", type: "textarea", required: true, maxLength: 300, rows: 2 },
          {
            key: "employmentStatus",
            label: "İş durumu / tipi",
            type: "select",
            required: true,
            options: SPONSOR_EMPLOYMENT_STATUS_OPTIONS,
            width: "half",
          },
          {
            key: "employmentStatusOther",
            label: "İş durumunu açıklayınız",
            type: "text",
            required: true,
            maxLength: 120,
            width: "half",
            visibleWhen: { path: "employmentStatus", equals: "other" },
          },
        ],
      },
    ],
  },
  {
    id: "travel",
    title: "Seyahat",
    fields: [
      { key: "departureDate", label: "Tahmini gidiş tarihiniz", type: "date", range: "future", required: true, width: "half" },
      {
        key: "returnDate",
        label: "Tahmini dönüş tarihiniz",
        type: "date",
        range: "future",
        required: true,
        width: "half",
        notBefore: [notBeforeLocal("departureDate", "Dönüş tarihi gidiş tarihinden önce olamaz.")],
      },
      { key: "purpose", label: "Gidiş amacınız", type: "select", required: true, options: TRAVEL_PURPOSE_OPTIONS, width: "half" },
      {
        key: "purposeOther",
        label: "Gidiş amacınızı kısaca yazınız",
        type: "text",
        required: true,
        maxLength: 120,
        width: "half",
        visibleWhen: { path: "purpose", equals: "other" },
      },
      {
        key: "business",
        label: "Ticari seyahat bilgileri",
        hint: "Ticari amaçla gidecekler için bu bilgilerin eksiksiz doldurulması gerekir.",
        type: "group",
        visibleWhen: { path: "purpose", equals: "business" },
        fields: [
          { key: "companyName", label: "Şirketin adı (kongre ise kongrenin adı)", type: "text", required: true, maxLength: 120 },
          { key: "activityField", label: "Faaliyet alanı", type: "text", required: true, maxLength: 120 },
          { key: "address", label: "Adresi", type: "textarea", required: true, maxLength: 300, rows: 2 },
          { key: "phone", label: "Telefon numarası", type: "phone", required: true, width: "half" },
          { key: "email", label: "E-posta adresi", type: "email", required: true, width: "half" },
          { key: "inviterName", label: "Davetiyeyi gönderen kişinin adı", type: "text", required: true, maxLength: 120 },
        ],
      },
      { key: "hasAccommodation", label: "Konaklama yeri ayarladınız mı?", type: "yesno", required: true },
      {
        key: "accommodationType",
        label: "Nerede kalacaksınız?",
        type: "select",
        required: true,
        options: ACCOMMODATION_TYPE_OPTIONS,
        width: "half",
        visibleWhen: { path: "hasAccommodation", equals: YES },
      },
      // Conditions also check the parent question: an old choice switched to "Hayır" (no) must not leave the sub-fields visible.
      {
        key: "hotel",
        label: "Otel bilgileri",
        type: "group",
        visibleWhen: { all: [{ path: "hasAccommodation", equals: YES }, { path: "accommodationType", equals: "hotel" }] },
        fields: [
          { key: "name", label: "Otelin tam adı", type: "text", required: true, maxLength: 120 },
          { key: "address", label: "Adresi", type: "textarea", required: true, maxLength: 300, rows: 2 },
        ],
      },
      {
        key: "host",
        label: "Yanında kalacağınız kişi",
        type: "group",
        visibleWhen: { all: [{ path: "hasAccommodation", equals: YES }, { path: "accommodationType", equals: "host" }] },
        fields: [
          ...personNameFields(true),
          { key: "address", label: "Adresi", type: "textarea", required: true, maxLength: 300, rows: 2 },
          { key: "email", label: "E-posta adresi", type: "email", required: true, width: "half" },
          { key: "phone", label: "Telefon numarası", type: "phone", required: true, width: "half" },
        ],
      },
      {
        key: "otherAccommodation",
        label: "Konaklama bilgileri",
        type: "group",
        visibleWhen: { all: [{ path: "hasAccommodation", equals: YES }, { path: "accommodationType", equals: "other" }] },
        fields: [
          {
            key: "place",
            label: "Kalacağınız yer",
            hint: "Örneğin Airbnb, Couchsurfing.",
            type: "text",
            required: true,
            maxLength: 120,
          },
          { key: "address", label: "Adresi", type: "textarea", required: true, maxLength: 300, rows: 2 },
        ],
      },
      { key: "travelsWithGroup", label: "Grupla mı seyahat ediyorsunuz?", type: "yesno", required: true },
      {
        key: "groupName",
        label: "Grubun adı",
        type: "text",
        required: true,
        maxLength: 120,
        width: "half",
        visibleWhen: { path: "travelsWithGroup", equals: YES },
      },
      // Only one person is asked; spouse and children are asked for in the Family section.
      {
        key: "hasCompanions",
        label: "Birlikte seyahat edeceğiniz biri var mı?",
        hint: "Eşinizi ve bakmakla yükümlü olduğunuz kişileri (çocuklarınızı) burada belirtmeyiniz; onların bilgileri Aile bölümünde istenir.",
        type: "yesno",
        required: true,
      },
      {
        key: "companion",
        label: "Birlikte seyahat edeceğiniz kişi",
        type: "group",
        visibleWhen: { path: "hasCompanions", equals: YES },
        fields: [
          ...personNameFields(true),
          countryField("nationality", "Uyruğu"),
          { key: "relationship", label: "Yakınlık derecesi", type: "text", required: true, maxLength: 60, width: "half" },
          {
            key: "passportNo",
            label: "Pasaport numarası",
            type: "text",
            required: true,
            maxLength: 20,
            uppercase: true,
            compact: true,
            pattern: PASSPORT_NO_PATTERN,
            width: "half",
          },
        ],
      },
    ],
  },
  {
    id: "family",
    title: "Aile",
    fields: [
      {
        key: "spouse",
        label: "Eşinizin bilgileri",
        type: "group",
        visibleWhen: { path: "personal.maritalStatus", scope: "root", equals: "married" },
        fields: [
          ...personNameFields(true),
          { key: "birthDate", label: "Doğum tarihi", type: "date", range: "past", required: true, width: "half" },
          countryField("nationality", "Milliyeti"),
          { key: "livesWithApplicant", label: "Eşiniz şu anda sizinle birlikte mi yaşıyor?", type: "yesno", required: true },
          {
            key: "address",
            label: "Eşinizin adresi",
            type: "textarea",
            required: true,
            maxLength: 300,
            rows: 2,
            visibleWhen: { path: "livesWithApplicant", equals: NO },
          },
          { key: "travelsWithApplicant", label: "Eşiniz sizinle birlikte seyahat edecek mi?", type: "yesno", required: true },
          {
            key: "passportNo",
            label: "Eşinizin pasaport numarası",
            type: "text",
            required: true,
            maxLength: 20,
            uppercase: true,
            compact: true,
            pattern: { regex: /^[A-Z0-9]{4,20}$/, message: "Pasaport numarası yalnızca harf ve rakam içermelidir." },
            width: "half",
            visibleWhen: { path: "travelsWithApplicant", equals: YES },
          },
        ],
      },
      {
        key: "hasDependents",
        label: "Bakmakla yükümlü olduğunuz kişiler (çocuklarınız) var mı?",
        type: "yesno",
        required: true,
      },
      {
        key: "children",
        label: "Bakmakla yükümlü olduğunuz kişiler / çocuklarınız",
        type: "repeat",
        itemLabel: "Kişi",
        addLabel: "Kişi ekle",
        min: 1,
        max: 10,
        visibleWhen: { path: "hasDependents", equals: YES },
        fields: [
          { key: "fullName", label: "Adı soyadı", type: "text", required: true, maxLength: 120, width: "half" },
          { key: "birthDate", label: "Doğum tarihi", type: "date", range: "past", required: true, width: "half" },
          { key: "livesWithApplicant", label: "Şu anda sizinle birlikte mi yaşıyor?", type: "yesno", required: true },
          {
            key: "address",
            label: "Adresi",
            type: "textarea",
            required: true,
            maxLength: 300,
            rows: 2,
            visibleWhen: { path: "livesWithApplicant", equals: NO },
          },
          { key: "travelsWithApplicant", label: "Sizinle birlikte seyahat edecek mi?", type: "yesno", required: true },
          { ...countryField("nationality", "Milliyeti"), visibleWhen: { path: "travelsWithApplicant", equals: YES } },
          {
            key: "passportNo",
            label: "Pasaport numarası",
            type: "text",
            required: true,
            maxLength: 20,
            uppercase: true,
            compact: true,
            pattern: { regex: /^[A-Z0-9]{4,20}$/, message: "Pasaport numarası yalnızca harf ve rakam içermelidir." },
            width: "half",
            visibleWhen: { path: "travelsWithApplicant", equals: YES },
          },
        ],
      },
      { key: "mother", label: "Annenizin bilgileri", type: "group", fields: parentFields },
      { key: "father", label: "Babanızın bilgileri", type: "group", fields: parentFields },
      {
        key: "hasUkRelative",
        label: "Birleşik Krallık'ta yaşayan akrabanız var mı?",
        hint: "Anne-baba veya çocuk, büyükanne-büyükbaba veya torun, eşinizin ailesi, çocuğunuzun eşi.",
        type: "yesno",
        required: true,
      },
      {
        key: "ukRelative",
        label: "Birleşik Krallık'taki akrabanız",
        type: "group",
        visibleWhen: { path: "hasUkRelative", equals: YES },
        fields: [
          { key: "fullName", label: "Adı soyadı", type: "text", required: true, maxLength: 120, width: "half" },
          { key: "relationship", label: "Yakınlık derecesi", type: "text", required: true, maxLength: 60, width: "half" },
          countryField("nationality", "Uyruğu"),
          {
            key: "status",
            label: "Statüsü",
            type: "text",
            required: true,
            maxLength: 80,
            hint: "Geçici oturum, süresiz oturum, vatandaşlık vb.",
            width: "half",
          },
          { key: "passportNo", label: "Pasaport numarası", type: "text", required: true, maxLength: 20, uppercase: true, compact: true, width: "half" },
          { key: "email", label: "E-posta adresi", type: "email", required: true, width: "half" },
          { key: "address", label: "Adresi", type: "textarea", required: true, maxLength: 300, rows: 2 },
          { key: "staysWithRelative", label: "Akrabanızın evinde mi kalacaksınız?", type: "yesno", required: true },
        ],
      },
    ],
  },
  {
    id: "history",
    title: "Seyahat geçmişi",
    fields: [
      { key: "hadUkVisaLast10Years", label: "Son 10 yıl içinde İngiltere vizesi aldınız mı?", type: "yesno", required: true },
      {
        key: "ukVisaIssueDate",
        label: "Vizenin veriliş tarihi",
        type: "date",
        range: "past",
        withinYears: LAST_TEN_YEARS,
        notBefore: [AFTER_BIRTH],
        required: true,
        width: "half",
        visibleWhen: { path: "hadUkVisaLast10Years", equals: YES },
      },
      {
        key: "hadUkMedicalTreatment",
        label: "İngiltere'de tıbbi tedavi gördünüz mü? (hastaneye gitme vb.)",
        type: "yesno",
        required: true,
      },
      {
        key: "ukMedicalTreatment",
        label: "Tıbbi tedavi bilgileri",
        type: "group",
        visibleWhen: { path: "hadUkMedicalTreatment", equals: YES },
        fields: [
          { key: "paid", label: "Ödeme yapıldı mı?", type: "yesno", required: true },
          { key: "address", label: "Tedavi görülen yerin açık adresi", type: "textarea", required: true, maxLength: 300, rows: 2 },
          { key: "entryDate", label: "Giriş tarihi", type: "date", range: "past", required: true, width: "half", notBefore: [AFTER_BIRTH] },
          {
            key: "exitDate",
            label: "Çıkış tarihi",
            type: "date",
            range: "past",
            width: "half",
            hint: "Tedavi sürüyorsa boş bırakınız.",
            notBefore: [notBeforeLocal("entryDate", "Çıkış tarihi giriş tarihinden önce olamaz.")],
          },
          { key: "stillReceiving", label: "Hâlâ bu tedaviyi alıyor musunuz?", type: "yesno", required: true },
        ],
      },
      {
        key: "ukVisitCount",
        label: "Son 10 yıl içinde İngiltere'ye kaç defa gittiniz?",
        type: "select",
        required: true,
        options: VISIT_COUNT_OPTIONS,
        width: "half",
      },
      {
        key: "ukVisits",
        label: "İngiltere seyahatleriniz",
        hint: "Üçten fazla seyahatiniz varsa yalnızca üçünün bilgilerini vermeniz yeterlidir.",
        type: "repeat",
        itemLabel: "Seyahat",
        addLabel: "Seyahat ekle",
        min: 1,
        max: 3,
        countBy: visitLimits("ukVisitCount", 3),
        visibleWhen: { path: "ukVisitCount", in: VISITED },
        fields: [
          {
            key: "date",
            label: "Gidiş tarihi (ay-yıl)",
            type: "month",
            range: "past",
            required: true,
            width: "half",
            withinYears: LAST_TEN_YEARS,
            notBefore: [AFTER_BIRTH],
          },
          { key: "duration", label: "Kalış süreniz", type: "text", required: true, maxLength: 40, hint: "Örneğin: 10 gün", width: "half" },
          { key: "purpose", label: "Gidiş amacınız", type: "text", required: true, maxLength: 80 },
        ],
      },
      {
        key: "hasUkNationalInsuranceNumber",
        label: "Birleşik Krallık Ulusal Sigorta numaranız (National Insurance Number) var mı?",
        type: "yesno",
        required: true,
      },
      {
        key: "ukNationalInsuranceNumber",
        label: "Ulusal Sigorta numaranız",
        type: "text",
        maxLength: 20,
        uppercase: true,
        hint: "Biliyorsanız yazınız.",
        width: "half",
        visibleWhen: { path: "hasUkNationalInsuranceNumber", equals: YES },
      },
      {
        key: "receivedUkPublicFunds",
        label: "Birleşik Krallık'ta devletten herhangi bir maddi yardım aldınız mı?",
        type: "yesno",
        required: true,
      },
      {
        key: "appliedUkLeaveToRemain",
        label: "Son 10 yılda Birleşik Krallık'ta oturum izni için başvuruda bulundunuz mu?",
        type: "yesno",
        required: true,
      },
      {
        key: "leaveToRemain",
        label: "Oturum izni başvurusu",
        type: "group",
        visibleWhen: { path: "appliedUkLeaveToRemain", equals: YES },
        fields: [
          {
            key: "applicationDate",
            label: "Başvuru tarihi",
            type: "date",
            range: "past",
            required: true,
            width: "half",
            withinYears: LAST_TEN_YEARS,
            notBefore: [AFTER_BIRTH],
          },
          { key: "result", label: "Sonuç", type: "text", required: true, maxLength: 200 },
        ],
      },
      {
        key: "otherCountriesVisitCount",
        label: "Son 10 yıl içinde Avustralya, Kanada, Yeni Zelanda, ABD ve Schengen ülkelerini kaç defa ziyaret ettiniz?",
        type: "select",
        required: true,
        options: VISIT_COUNT_OPTIONS,
        width: "half",
      },
      {
        key: "otherCountriesVisits",
        label: "Bu ülkelere yaptığınız seyahatler",
        hint: "İkiden fazla ülkeye seyahat ettiyseniz yalnızca iki ülkenin bilgilerini vermeniz yeterlidir.",
        type: "repeat",
        itemLabel: "Seyahat",
        addLabel: "Seyahat ekle",
        min: 1,
        max: 2,
        countBy: visitLimits("otherCountriesVisitCount", 2),
        visibleWhen: { path: "otherCountriesVisitCount", in: VISITED },
        fields: [
          countryField("country", "Hangi ülke"),
          {
            key: "date",
            label: "Gidiş tarihi (ay-yıl)",
            type: "month",
            range: "past",
            required: true,
            width: "half",
            withinYears: LAST_TEN_YEARS,
            notBefore: [AFTER_BIRTH],
          },
          { key: "duration", label: "Kalış süreniz", type: "text", required: true, maxLength: 40, width: "half" },
          { key: "purpose", label: "Gidiş amacınız", type: "text", required: true, maxLength: 80, width: "half" },
        ],
      },
      {
        key: "visitedElsewhere",
        label: "Son 10 yıl içinde yukarıdaki ülkelerin dışında herhangi bir ülkeyi ziyaret ettiniz mi?",
        type: "yesno",
        required: true,
      },
      {
        key: "elsewhereVisits",
        label: "Diğer ülkelere yaptığınız seyahatler",
        hint: "Ziyaret ettiğiniz tüm ülkeleri yazınız.",
        type: "repeat",
        itemLabel: "Seyahat",
        addLabel: "Seyahat ekle",
        min: 1,
        // This number is only a technical cap that keeps the record from growing excessively.
        max: 100,
        visibleWhen: { path: "visitedElsewhere", equals: YES },
        fields: [
          countryField("country", "Hangi ülke"),
          { key: "purpose", label: "Gidiş amacınız", type: "text", required: true, maxLength: 80, width: "half" },
          {
            key: "departureDate",
            label: "Gidiş tarihi",
            type: "date",
            range: "past",
            required: true,
            width: "half",
            withinYears: LAST_TEN_YEARS,
            notBefore: [AFTER_BIRTH],
          },
          {
            key: "returnDate",
            label: "Dönüş tarihi",
            type: "date",
            range: "past",
            required: true,
            width: "half",
            notBefore: [notBeforeLocal("departureDate", "Dönüş tarihi gidiş tarihinden önce olamaz.")],
          },
        ],
      },
    ],
  },
  {
    id: "security",
    title: "Ret geçmişi",
    fields: [
      {
        key: "ukRefusal",
        // Number, dates and reasons of refusals are not separate fields; they are written in the explanation.
        label:
          "Birleşik Krallık'tan vize reddi aldınız mı, sınır dışı edildiniz mi, çıkarıldınız mı veya ayrılmanız gerekti mi? (Ret sayısı, ret tarihleri ve ret sebepleri)",
        type: "yesno",
        required: true,
      },
      {
        key: "ukRefusalDetails",
        label: "Lütfen açıklayınız",
        type: "textarea",
        required: true,
        maxLength: 1000,
        rows: 4,
        hint: "Olayı kısaca anlatınız.",
        visibleWhen: UK_REFUSAL_VISIBLE,
      },
      {
        key: "otherRefusal",
        label:
          "Birleşik Krallık dışındaki herhangi bir ülkede başvurunuz reddedildi mi, sınır dışı edildiniz mi, çıkarıldınız mı, ayrılmanız istendi mi veya sınırda girişiniz engellendi mi?",
        type: "yesno",
        required: true,
      },
      {
        key: "otherRefusalDetails",
        label: "Lütfen açıklayınız",
        type: "textarea",
        required: true,
        maxLength: 1000,
        rows: 4,
        hint: "Ülkeyi, tarihi ve gerekçeyi belirtiniz.",
        visibleWhen: { path: "otherRefusal", equals: YES },
      },
    ],
  },
  {
    id: "additional",
    title: "Ek bilgiler",
    fields: [
      {
        key: "notes",
        label: "Özel olarak belirtmek istediğiniz başka bir durum var mı?",
        type: "textarea",
        maxLength: 2000,
        rows: 6,
        hint: "Örneğin İngiltere'de yaşadığınız bir sorun. Yoksa boş bırakabilirsiniz.",
      },
    ],
  },
];

export const SECTION_IDS: readonly SectionId[] = FORM_SECTIONS.map((s) => s.id);

export function isSectionId(value: string): value is SectionId {
  return (SECTION_IDS as readonly string[]).includes(value);
}

export function getSection(id: SectionId): Section {
  const section = FORM_SECTIONS.find((s) => s.id === id);
  if (!section) throw new Error(`Bilinmeyen form bölümü: ${id}`);
  return section;
}
