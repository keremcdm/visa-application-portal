import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb } from "pdf-lib";
import { sanitizeForFont, wrapText } from "@/features/form-pdf/layout-engine";
import type { DocumentRequirement } from "@/lib/domain/constants";

/**
 * DOCUMENT CHECKLIST PDF
 *
 * The "Evrak listesi (PDF)" button on the customer's Documents page. The logo centered at the top of the page and below it,
 * without any other text, only the numbered list of the documents required for the application (the list synced to the
 * application types the customer chose, in on-screen order). "(isteğe bağlı)" (optional) is written next to optional documents.
 */

export type ChecklistSource = { label: string; requirement: DocumentRequirement; outOfScope: boolean };
export type ChecklistItem = { label: string; optional: boolean };
export type ChecklistPdfAssets = { regularFont: Uint8Array; logoPng: Uint8Array };

/** Documents to include: those required for the application type (old slots that fell out of scope are excluded), in the given order. */
export function checklistItems(slots: readonly ChecklistSource[]): ChecklistItem[] {
  return slots.filter((slot) => !slot.outOfScope).map((slot) => ({ label: slot.label.trim(), optional: slot.requirement === "optional" }));
}

const A4 = { width: 595.28, height: 841.89 };
const MARGIN_X = 64;
const MARGIN_TOP = 48;
const MARGIN_BOTTOM = 56;
const LOGO_WIDTH = 150;
const LOGO_GAP = 36;
const FONT_SIZE = 12;
const LINE_HEIGHT = 17;
const ITEM_GAP = 9;
const NUMBER_WIDTH = 26;
const INK = rgb(0x19 / 255, 0x21 / 255, 0x4f / 255);
const MUTED = rgb(0x58 / 255, 0x5e / 255, 0x80 / 255);
const OPTIONAL_SUFFIX = " (isteğe bağlı)";

export async function buildChecklistPdf(items: readonly ChecklistItem[], assets: ChecklistPdfAssets): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Evrak listesi");
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(assets.regularFont, { subset: true });
  const supported = new Set(font.getCharacterSet());
  const logo = await doc.embedPng(assets.logoPng);
  const measure = (text: string) => font.widthOfTextAtSize(text, FONT_SIZE);
  const textWidth = A4.width - MARGIN_X * 2 - NUMBER_WIDTH;

  let page = doc.addPage([A4.width, A4.height]);
  const logoHeight = (logo.height / logo.width) * LOGO_WIDTH;
  page.drawImage(logo, { x: (A4.width - LOGO_WIDTH) / 2, y: A4.height - MARGIN_TOP - logoHeight, width: LOGO_WIDTH, height: logoHeight });
  let y = A4.height - MARGIN_TOP - logoHeight - LOGO_GAP;

  items.forEach((item, index) => {
    const label = sanitizeForFont(item.label, supported);
    const suffix = item.optional ? sanitizeForFont(OPTIONAL_SUFFIX, supported) : "";
    // If the suffix does not fit on the last line it moves to its own line, so the document name and the suffix never blend in the same color.
    const lines = wrapText(label, measure, textWidth);
    const lastWidth = measure(lines[lines.length - 1] ?? "");
    const suffixOnNewLine = suffix !== "" && lastWidth + measure(suffix) > textWidth;
    const lineCount = lines.length + (suffixOnNewLine ? 1 : 0);
    if (y - lineCount * LINE_HEIGHT < MARGIN_BOTTOM) {
      page = doc.addPage([A4.width, A4.height]);
      y = A4.height - MARGIN_TOP;
    }

    const number = `${index + 1}.`;
    page.drawText(number, { x: MARGIN_X + NUMBER_WIDTH - 8 - measure(number), y: y - FONT_SIZE, size: FONT_SIZE, font, color: INK });
    lines.forEach((line, i) => {
      page.drawText(line, { x: MARGIN_X + NUMBER_WIDTH, y: y - FONT_SIZE - i * LINE_HEIGHT, size: FONT_SIZE, font, color: INK });
    });
    if (suffix) {
      const suffixLine = suffixOnNewLine ? lines.length : lines.length - 1;
      const x = MARGIN_X + NUMBER_WIDTH + (suffixOnNewLine ? 0 : lastWidth);
      page.drawText(suffixOnNewLine ? suffix.trimStart() : suffix, { x, y: y - FONT_SIZE - suffixLine * LINE_HEIGHT, size: FONT_SIZE, font, color: MUTED });
    }
    y -= lineCount * LINE_HEIGHT + ITEM_GAP;
  });

  return doc.save();
}
