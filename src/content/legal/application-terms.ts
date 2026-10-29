import type { LegalDocumentContent } from "./types";

/** Version of the text: what the customer accepted is recorded with this value; when the text changes the version changes too. */
export const APPLICATION_TERMS_VERSION = "2026-10-23";

/**
 * Placeholder. The organization using the portal adds the text prepared by its legal counsel here in this structure
 * (headings, paragraphs, tables); the page is rendered with src/components/layout/legal-document.tsx.
 */
export const APPLICATION_TERMS: LegalDocumentContent = {
  eyebrow: null,
  title: "BAŞVURU HİZMET ŞARTLARI VE ONAY BEYANI",
  meta: [],
  blocks: [
    {
      type: "p",
      text: "Bu metin, portalı kullanan kuruluşun hukuk danışmanı tarafından hazırlanır ve buraya eklenir.",
    },
  ],
};
