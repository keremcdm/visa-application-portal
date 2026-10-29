/**
 * FORM FIELD HELP CONTENT
 *
 * To add a help (question mark) button to a field, adding an entry to this list is enough;
 * no other code needs to change.
 *
 *   key         : "<section id>.<field path>" — no index for repeated entries.
 *                 E.g. "passport.issuingAuthority", "family.children.passportNo"
 *   title       : Title of the help dialog.
 *   description : Short explanation (plain text).
 *   image       : (optional) name of a file in the `public/images/form-help/` folder.
 *   imageAlt    : Description for users who cannot see the image (required if there is an image).
 *
 * If the image file is missing from the folder the dialog does not show a broken image; it shows only the description with
 * a "Görsel henüz eklenmedi" (image not added yet) note.
 */

export type FieldHelp = {
  title: string;
  description: string;
  image?: string;
  imageAlt?: string;
};

export const FORM_HELP_IMAGE_DIR = "/images/form-help";

export const FIELD_HELP: Readonly<Record<string, FieldHelp>> = {
  "personal.birthPlace": {
    title: "Doğum yeri",
    description:
      "Pasaportunuzun kimlik sayfasında “Doğum Yeri / Place of Birth” başlığı altında yazan yeri, pasaportta yazdığı şekilde giriniz.",
    image: "passport-birth-place.jpg",
    imageAlt: "Pasaport kimlik sayfasında doğum yeri alanının konumu",
  },
  "passport.passportNo": {
    title: "Pasaport numarası",
    description:
      "Pasaportunuzun kimlik sayfasının sağ üst köşesinde “Pasaport No / Passport No” başlığı altında yer alır. Harf ve rakamları boşluk bırakmadan yazınız.",
    image: "passport-number.jpg",
    imageAlt: "Pasaport kimlik sayfasında pasaport numarasının konumu",
  },
  "passport.issuingAuthority": {
    title: "Pasaportu veren makam",
    description:
      "Pasaportunuzun kimlik sayfasında “Veren Makam / Authority” başlığı altında yazan kurumu, pasaportta yazdığı şekilde giriniz.",
    image: "passport-issuing-authority.jpg",
    imageAlt: "Pasaport kimlik sayfasında veren makam alanının konumu",
  },
  "passport.issueDate": {
    title: "Pasaport veriliş tarihi",
    description: "Pasaportunuzun kimlik sayfasında “Veriliş Tarihi / Date of Issue” başlığı altında yazan tarihtir.",
    image: "passport-issue-date.jpg",
    imageAlt: "Pasaport kimlik sayfasında veriliş tarihinin konumu",
  },
  "passport.expiryDate": {
    title: "Pasaport geçerlilik tarihi",
    description:
      "Pasaportunuzun kimlik sayfasında “Geçerlilik Tarihi / Date of Expiry” başlığı altında yazan tarihtir.",
    image: "passport-expiry-date.jpg",
    imageAlt: "Pasaport kimlik sayfasında geçerlilik tarihinin konumu",
  },
  "employment.employmentStartDate": {
    title: "İşe başlangıç tarihi",
    description:
      "SGK işe giriş bildirgenizde veya e-Devlet'ten aldığınız SGK Tescil ve Hizmet Dökümü'nde yazan işe giriş tarihidir. Ay ve yıl yeterlidir.",
  },
};

/** "children.0.passportNo" -> "children.passportNo" */
export function helpKeyFor(sectionId: string, fieldPath: string): string {
  const withoutIndexes = fieldPath
    .split(".")
    .filter((part) => !/^\d+$/.test(part))
    .join(".");
  return `${sectionId}.${withoutIndexes}`;
}

export function getFieldHelp(sectionId: string, fieldPath: string): FieldHelp | null {
  return FIELD_HELP[helpKeyFor(sectionId, fieldPath)] ?? null;
}
