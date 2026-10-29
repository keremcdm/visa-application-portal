import type { LegalDocumentContent } from "./types";

/**
 * Placeholder. The organization using the portal adds the text prepared by its legal counsel here in this structure
 * (headings, paragraphs, tables); the page is rendered with src/components/layout/legal-document.tsx.
 */
export const COOKIE_POLICY: LegalDocumentContent = {
  eyebrow: null,
  title: "ÇEREZ POLİTİKASI",
  meta: [],
  blocks: [
    {
      type: "p",
      text: "Bu metin, portalı kullanan kuruluşun hukuk danışmanı tarafından hazırlanır ve buraya eklenir.",
    },
  ],
};
