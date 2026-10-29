// Developer tool for inspecting the layout of a PDF template.
// Writes each page's text items with their positions to JSON and the page images to PNG.
// Used when extracting field coordinates for a new form template.
//
// Usage:
//   node scripts/pdf-template-inspect.mjs <pdf-path> <output-dir> [scale]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

//   node scripts/pdf-template-inspect.mjs <pdf-path> <output-dir> <scale> <page> <x0,y0,x1,y1>
//     -> saves only the given region (in PDF coordinates) of the given page, enlarged (for calibration).
const [pdfPath, outDir, scaleArg, pageArg, cropArg] = process.argv.slice(2);
if (!pdfPath || !outDir) {
  console.error("Usage: node scripts/pdf-template-inspect.mjs <pdf-path> <output-dir> [scale] [page] [x0,y0,x1,y1]");
  process.exit(1);
}
const scale = Number(scaleArg ?? "1.5");
const onlyPage = pageArg ? Number(pageArg) : null;
const crop = cropArg ? cropArg.split(",").map(Number) : null;

await mkdir(outDir, { recursive: true });
const data = new Uint8Array(await readFile(pdfPath));
const doc = await getDocument({ data, useSystemFonts: true }).promise;

const round = (n) => Math.round(n * 100) / 100;
const summary = [];

for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
  if (onlyPage && pageNo !== onlyPage) continue;
  const page = await doc.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });

  if (crop) {
    const [x0, y0, x1, y1] = crop;
    const viewport = page.getViewport({ scale });
    const full = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const fullCtx = full.getContext("2d");
    fullCtx.fillStyle = "#ffffff";
    fullCtx.fillRect(0, 0, full.width, full.height);
    await page.render({ canvasContext: fullCtx, viewport, canvas: full }).promise;
    const w = Math.ceil((x1 - x0) * scale);
    const h = Math.ceil((y1 - y0) * scale);
    const part = createCanvas(w, h);
    // In PDF the y axis points up; it is flipped for the image.
    part.getContext("2d").drawImage(full, x0 * scale, (base.height - y1) * scale, w, h, 0, 0, w, h);
    const name = `crop-p${pageNo}-${x0}-${y0}-${x1}-${y1}.png`;
    await writeFile(path.join(outDir, name), part.toBuffer("image/png"));
    summary.push({ page: pageNo, crop: name });
    continue;
  }
  const text = await page.getTextContent();

  const items = text.items
    .filter((it) => typeof it.str === "string" && it.str.trim() !== "")
    .map((it) => ({
      str: it.str,
      x: round(it.transform[4]),
      // PDF coordinate (origin at the bottom-left corner)
      y: round(it.transform[5]),
      w: round(it.width),
      h: round(it.height),
    }));

  // Collect rectangle/line paths to find the table lines.
  const ops = await page.getOperatorList();
  const rects = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    if (ops.fnArray[i] === OPS.constructPath) {
      const args = ops.argsArray[i];
      const minMax = args?.[2];
      if (minMax && minMax.length === 4) {
        rects.push(Array.from(minMax, round));
      }
    }
  }

  await writeFile(
    path.join(outDir, `page-${String(pageNo).padStart(2, "0")}.json`),
    JSON.stringify({ page: pageNo, width: round(base.width), height: round(base.height), items, rects }, null, 1),
  );

  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  await writeFile(path.join(outDir, `page-${String(pageNo).padStart(2, "0")}.png`), canvas.toBuffer("image/png"));

  summary.push({ page: pageNo, width: round(base.width), height: round(base.height), textItems: items.length, paths: rects.length });
}

console.log(JSON.stringify({ pages: doc.numPages, summary }, null, 1));
