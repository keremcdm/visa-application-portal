/** Structure in which the legal counsel's texts are shown on the page (src/components/layout/legal-document.tsx). */
export type LegalBlock =
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "p"; text: string }
  | { type: "table"; head: string[]; rows: string[][] };

export type LegalDocumentContent = {
  /** Introductory name above the document; null if none. */
  eyebrow: string | null;
  /** The document's own title, as written (in upper case). */
  title: string | null;
  /** Header lines such as publication date, address, contact. */
  meta: string[];
  blocks: LegalBlock[];
};
