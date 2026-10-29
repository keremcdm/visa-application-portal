import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadChecklistPdfAssets } from "@/features/documents/checklist-assets";
import { buildChecklistPdf, checklistItems, type ChecklistPdfAssets } from "@/features/documents/checklist-pdf";
import { extractPdfText } from "../helpers/pdf-text";

/** Document checklist PDF: logo at the top, a numbered list without any text below. */

let assets: ChecklistPdfAssets;
beforeAll(async () => {
  assets = await loadChecklistPdfAssets();
});

describe("evrak listesi PDF'i", () => {
  it("documents required for the application type enter the list in order; an old out-of-scope slot does not", () => {
    expect(
      checklistItems([
        { label: "Geçerli pasaport ", requirement: "required", outOfScope: false },
        { label: "Eski pasaportlar", requirement: "optional", outOfScope: false },
        { label: "Öğrenci belgesi", requirement: "optional", outOfScope: true },
      ]),
    ).toEqual([
      { label: "Geçerli pasaport", optional: false },
      { label: "Eski pasaportlar", optional: true },
    ]);
  });

  it("besides the logo it only writes numbered document names and the optional suffix (Turkish characters stay intact)", async () => {
    const bytes = await buildChecklistPdf(
      [
        { label: "Geçerli pasaport", optional: false },
        { label: "Son üç aya ait banka hesap dökümü (ıslak imzalı, kaşeli)", optional: false },
        { label: "Eski pasaportlar", optional: true },
      ],
      assets,
    );
    await mkdir(path.join(process.cwd(), "tmp"), { recursive: true });
    await writeFile(path.join(process.cwd(), "tmp", "evrak-listesi-ornek.pdf"), bytes);
    const text = await extractPdfText(bytes);
    expect(text.pageCount).toBe(1);
    expect(text.items.map((i) => i.str.trim())).toEqual([
      "1.",
      "Geçerli pasaport",
      "2.",
      "Son üç aya ait banka hesap dökümü (ıslak imzalı, kaşeli)",
      "3.",
      // The PDF reader merges two texts on the same line (the suffix is written in grey).
      "Eski pasaportlar (isteğe bağlı)",
    ]);
    // The list starts below the logo (the logo is at the top center of the page).
    expect(Math.max(...text.items.map((i) => i.y))).toBeLessThan(841.89 - 48 - 70);
  });

  it("a long list continues on the next page; a long document name wraps into lines", async () => {
    const items = Array.from({ length: 45 }, (_, i) => ({ label: `Belge ${i + 1} ${"uzun açıklamalı ad ".repeat(i === 0 ? 8 : 1)}`.trim(), optional: i % 2 === 1 }));
    const text = await extractPdfText(await buildChecklistPdf(items, assets));
    expect(text.pageCount).toBe(2);
    expect(text.pages.join("\n")).toContain("45.");
    const firstLines = text.items.filter((i) => i.page === 0 && i.str.startsWith("Belge 1 ") === false && i.str.includes("uzun açıklamalı"));
    expect(firstLines.length).toBeGreaterThan(0);
  });

  it("an empty list has only the logo", async () => {
    const text = await extractPdfText(await buildChecklistPdf([], assets));
    expect(text.pageCount).toBe(1);
    expect(text.items).toEqual([]);
  });
});
