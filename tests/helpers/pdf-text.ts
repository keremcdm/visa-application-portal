import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export type PdfTextItem = { str: string; x: number; y: number; width: number; page: number };

/** Extracts the text items of a generated PDF with their positions (for assertions). */
export async function extractPdfText(bytes: Uint8Array): Promise<{ pageCount: number; items: PdfTextItem[]; pages: string[] }> {
  // pdfjs takes ownership of the buffer it is given; we pass a copy.
  const loadingTask = getDocument({ data: bytes.slice(), useSystemFonts: true, verbosity: 0 });
  const doc = await loadingTask.promise;
  const items: PdfTextItem[] = [];
  const pages: string[] = [];
  for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
    const page = await doc.getPage(pageNo);
    const content = await page.getTextContent();
    const parts: string[] = [];
    for (const item of content.items) {
      if (!("str" in item) || item.str.trim() === "") continue;
      parts.push(item.str);
      items.push({
        str: item.str,
        x: item.transform[4] as number,
        y: item.transform[5] as number,
        width: item.width,
        page: pageNo - 1,
      });
    }
    pages.push(parts.join("\n"));
  }
  const pageCount = doc.numPages;
  await loadingTask.destroy();
  return { pageCount, items, pages };
}
