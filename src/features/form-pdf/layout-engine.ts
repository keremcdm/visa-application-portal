import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * Engine that places text on top of flat PDF templates (without form fields).
 *
 * - Text is shrunk in point size and wrapped into lines until it fits the given box.
 * - If it still does not fit at the smallest size the text is NOT CUT: "Bkz. Ek (n)" (see appendix n) is written in the box
 *   and the full text is moved to an "Ek sayfa" (appendix page) added at the end of the document.
 */

export type Mask = { x: number; y: number; width: number; height: number };

export type Placement = {
  /** Unique id for tests and debugging. */
  id: string;
  /** Human-readable field name shown on the appendix page. */
  label: string;
  /** 0-based page number. */
  page: number;
  x: number;
  width: number;
  /** Baseline of the first line (PDF coordinate, bottom-left origin). */
  firstBaseline: number;
  /** Lowest point the text may reach. */
  bottom: number;
  /** Left indent of the first line (to write to the right of the label). */
  indent?: number;
  text: string;
  bold?: boolean;
  size?: number;
  /** Areas painted white before the text (to cover the hint text in the template). */
  masks?: readonly Mask[];
};

export type AppendixEntry = { number: number; label: string; text: string };

export type FillResult = {
  bytes: Uint8Array;
  /** Fields moved to the appendix page because they do not fit the template. */
  overflow: AppendixEntry[];
  pageCount: number;
};

export type FillOptions = {
  template: Uint8Array;
  regularFont: Uint8Array;
  boldFont: Uint8Array;
  placements: readonly Placement[];
  /** Extra entries that do not fit the template at all (e.g. a 3rd child); written straight to the appendix page. */
  extraEntries?: ReadonlyArray<{ label: string; text: string }>;
  /** Small info line written at the bottom left of every page. */
  footer?: string;
  /** Line written below the appendix page title (e.g. the applicant). */
  appendixSubtitle?: string;
  title?: string;
};

const DEFAULT_SIZE = 9.5;
const MIN_SIZE = 6.5;
const SIZE_STEP = 0.5;
const LINE_HEIGHT_FACTOR = 1.2;
const DESCENT_FACTOR = 0.22;
const INK = rgb(0.05, 0.07, 0.2);
const MUTED = rgb(0.4, 0.4, 0.45);

/** Removes characters missing from the font and control characters. */
export function sanitizeForFont(text: string, supported: Set<number>): string {
  let result = "";
  for (const ch of text.normalize("NFC")) {
    const code = ch.codePointAt(0)!;
    if (ch === "\n") {
      result += ch;
    } else if (ch === "\t" || code === 0xa0) {
      result += " ";
    } else if (code < 0x20 || code === 0x7f) {
      continue;
    } else if (supported.has(code)) {
      result += ch;
    } else {
      result += "?";
    }
  }
  return result;
}

/** Wraps text into lines for the given widths. The first line can be `firstWidth` wide, the others `width`. */
export function wrapText(
  text: string,
  measure: (s: string) => number,
  width: number,
  firstWidth: number = width,
): string[] {
  const lines: string[] = [];
  const widthFor = () => (lines.length === 0 ? firstWidth : width);

  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(" ").filter((w) => w !== "");
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (let word of words) {
      const candidate = current === "" ? word : `${current} ${word}`;
      if (measure(candidate) <= widthFor()) {
        current = candidate;
        continue;
      }
      if (current !== "") {
        lines.push(current);
        current = "";
      }
      // Split a word that does not fit on a line by itself character by character.
      while (measure(word) > widthFor()) {
        let cut = word.length - 1;
        while (cut > 1 && measure(word.slice(0, cut)) > widthFor()) cut--;
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      current = word;
    }
    lines.push(current);
  }
  // Drop leading/trailing empty lines.
  while (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

type Fit = { size: number; lines: string[] };

function fitText(placement: Placement, font: PDFFont): Fit | null {
  const indent = placement.indent ?? 0;
  const start = placement.size ?? DEFAULT_SIZE;
  for (let size = start; size >= MIN_SIZE - 1e-9; size -= SIZE_STEP) {
    const lineHeight = size * LINE_HEIGHT_FACTOR;
    const available = placement.firstBaseline - size * DESCENT_FACTOR - placement.bottom;
    if (available < 0) continue;
    const maxLines = Math.floor(available / lineHeight) + 1;
    const measure = (s: string) => font.widthOfTextAtSize(s, size);
    const lines = wrapText(placement.text, measure, placement.width, placement.width - indent);
    if (lines.length <= maxLines) return { size, lines };
  }
  return null;
}

function drawFit(page: PDFPage, placement: Placement, fit: Fit, font: PDFFont): void {
  const lineHeight = fit.size * LINE_HEIGHT_FACTOR;
  fit.lines.forEach((line, index) => {
    if (line === "") return;
    page.drawText(line, {
      x: placement.x + (index === 0 ? (placement.indent ?? 0) : 0),
      y: placement.firstBaseline - index * lineHeight,
      size: fit.size,
      font,
      color: INK,
    });
  });
}

const A4: [number, number] = [595.32, 841.92];
const MARGIN = 48;

function drawAppendix(
  doc: PDFDocument,
  entries: ReadonlyArray<{ heading: string; text: string }>,
  fonts: { regular: PDFFont; bold: PDFFont },
  options: FillOptions,
): void {
  const contentWidth = A4[0] - MARGIN * 2;
  let page = doc.addPage(A4);
  let y = A4[1] - MARGIN;

  const newPage = () => {
    page = doc.addPage(A4);
    y = A4[1] - MARGIN;
  };
  const ensure = (needed: number) => {
    if (y - needed < MARGIN) newPage();
  };

  page.drawText("EK SAYFA", { x: MARGIN, y: y - 14, size: 14, font: fonts.bold, color: INK });
  y -= 32;
  const intro =
    "Bu belge müşterinin portalda verdiği cevaplardan otomatik oluşturulmuştur. Şablondaki alana sığmayan cevaplar aşağıdadır.";
  page.drawText(intro, { x: MARGIN, y, size: 9, font: fonts.regular, color: MUTED });
  y -= 14;
  if (options.appendixSubtitle) {
    page.drawText(options.appendixSubtitle, { x: MARGIN, y, size: 9, font: fonts.regular, color: MUTED });
    y -= 14;
  }
  y -= 8;

  const size = 10;
  const lineHeight = size * 1.35;
  for (const entry of entries) {
    const headingLines = wrapText(entry.heading, (s) => fonts.bold.widthOfTextAtSize(s, size), contentWidth);
    ensure(lineHeight * (headingLines.length + 1));
    for (const line of headingLines) {
      page.drawText(line, { x: MARGIN, y, size, font: fonts.bold, color: INK });
      y -= lineHeight;
    }
    const lines = wrapText(entry.text, (s) => fonts.regular.widthOfTextAtSize(s, size), contentWidth);
    for (const line of lines) {
      ensure(lineHeight);
      if (line !== "") page.drawText(line, { x: MARGIN, y, size, font: fonts.regular, color: INK });
      y -= lineHeight;
    }
    y -= lineHeight * 0.6;
  }
}

export async function fillTemplate(options: FillOptions): Promise<FillResult> {
  const doc = await PDFDocument.load(options.template);
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(options.regularFont, { subset: true });
  const bold = await doc.embedFont(options.boldFont, { subset: true });
  const supported = new Set(regular.getCharacterSet());
  const pages = doc.getPages();

  const overflow: AppendixEntry[] = [];

  for (const raw of options.placements) {
    const text = sanitizeForFont(raw.text, supported).trim();
    if (text === "") continue;
    const page = pages[raw.page];
    if (!page) throw new Error(`Şablonda ${raw.page + 1}. sayfa yok (alan: ${raw.id}).`);
    const font = raw.bold ? bold : regular;
    const placement: Placement = { ...raw, text };

    for (const mask of raw.masks ?? []) {
      page.drawRectangle({ x: mask.x, y: mask.y, width: mask.width, height: mask.height, color: rgb(1, 1, 1) });
    }

    const fit = fitText(placement, font);
    if (fit) {
      drawFit(page, placement, fit, font);
      continue;
    }

    const number = overflow.length + 1;
    overflow.push({ number, label: raw.label, text });
    const marker = fitText({ ...placement, text: `Bkz. Ek (${number})`, indent: raw.indent }, bold) ??
      fitText({ ...placement, text: `Ek (${number})`, indent: raw.indent }, bold);
    if (!marker) {
      throw new Error(`"${raw.id}" alanına ek sayfa işareti bile sığmıyor; şablon koordinatlarını kontrol edin.`);
    }
    drawFit(page, placement, marker, bold);
  }

  const appendix = [
    ...overflow.map((e) => ({ heading: `(${e.number}) ${e.label}`, text: e.text })),
    ...(options.extraEntries ?? []).map((e) => ({
      heading: sanitizeForFont(e.label, supported),
      text: sanitizeForFont(e.text, supported),
    })),
  ];
  if (appendix.length > 0) {
    drawAppendix(doc, appendix, { regular, bold }, options);
  }

  if (options.footer) {
    const footer = sanitizeForFont(options.footer, supported);
    for (const page of doc.getPages()) {
      page.drawText(footer, { x: 31, y: 16, size: 6.5, font: regular, color: MUTED });
    }
  }

  if (options.title) doc.setTitle(options.title);
  doc.setProducer("Vize Başvuru Portalı");
  doc.setCreator("Vize Başvuru Portalı");

  const bytes = await doc.save();
  return { bytes, overflow, pageCount: doc.getPageCount() };
}
