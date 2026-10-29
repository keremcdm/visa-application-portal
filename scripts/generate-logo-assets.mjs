// Generates the PNGs used in e-mails and as the browser tab icon from the logo.
// Most e-mail clients do not render SVG, so e-mails use PNG.
// Usage: node scripts/generate-logo-assets.mjs
//   public/brand/logo-email.png  — logo in the Supabase e-mail templates (360 × 189, 2x)
//   src/server/email/logo-png.ts      — the same PNG embedded in the app's notification e-mails (base64)
//   public/brand/icon.svg / .png  — tab icon (64 × 64; the mark at the top only)
//   src/app/favicon.ico               — the same mark for older browsers (16, 32, 48 px)
//   assets/brand/logo.png         — logo on the customer's document checklist PDF (1040 px wide, transparent background)
//
// When the logo changes, dimensions are read from the SVG's viewBox. The e-mail image is
// always 360 × 189 (templates display it at 152 × 80); the logo is centered in that area keeping its aspect ratio, so the
// Supabase templates never need to be pasted again. For the tab icon the caption (bottom quarter of the logo) is removed
// and the remaining mark is centered in a square using its bounds measured from the pixels.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const svgPath = path.join(root, "public", "brand", "logo.svg");
const svg = await readFile(svgPath, "utf8");

const viewBox = /viewBox="([\d.\s-]+)"/.exec(svg)?.[1].trim().split(/\s+/).map(Number);
if (!viewBox || viewBox.length !== 4) throw new Error("Could not read the logo's viewBox.");
const [, , logoWidth, logoHeight] = viewBox;

const EMAIL = { width: 360, height: 189 };

/** Centers the SVG in the given area keeping its aspect ratio; the background is transparent. */
async function render(source, width, height, box = { width, height }) {
  const image = await loadImage(Buffer.from(source));
  const canvas = createCanvas(width, height);
  const scale = Math.min(width / box.width, height / box.height);
  const drawWidth = box.width * scale;
  const drawHeight = box.height * scale;
  canvas.getContext("2d").drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  return canvas;
}

// E-mail logo: the full logo, centered in a 360 × 189 area.
const emailPng = await (await render(svg, EMAIL.width, EMAIL.height, { width: logoWidth, height: logoHeight })).encode("png");
await writeFile(path.join(root, "public", "brand", "logo-email.png"), emailPng);
await writeFile(
  path.join(root, "src", "server", "email", "logo-png.ts"),
  `// Generated file: node scripts/generate-logo-assets.mjs (do not edit by hand).\n// Logo embedded in notification e-mails (from public/brand/logo.svg, centered in a 360 × 189 area).\nexport const LOGO_PNG_BASE64 =\n  "${emailPng.toString("base64")}";\nexport const LOGO_PNG_SIZE = { width: ${EMAIL.width}, height: ${EMAIL.height} } as const;\n`,
);

// Document checklist PDF (src/features/documents/checklist-pdf.ts): a high-resolution PNG of the logo, since PDF cannot embed SVG.
const PDF_LOGO_WIDTH = 1040;
const pdfLogoHeight = Math.round((PDF_LOGO_WIDTH * logoHeight) / logoWidth);
await mkdir(path.join(root, "assets", "brand"), { recursive: true });
await writeFile(
  path.join(root, "assets", "brand", "logo.png"),
  await (await render(svg, PDF_LOGO_WIDTH, pdfLogoHeight, { width: logoWidth, height: logoHeight })).encode("png"),
);

// Tab icon: the caption's paths (those starting in the bottom quarter of the logo) are removed.
const markOnly = svg
  .split("\n")
  .filter((line) => {
    const m = /<path d="M([\d.-]+) ([\d.-]+)/.exec(line);
    return !m || Number(m[2]) < logoHeight * 0.72;
  })
  .join("\n");

// The mark's bounds are measured from the pixels (drawn at 1 unit = 1 pixel).
const probe = await render(markOnly, Math.ceil(logoWidth), Math.ceil(logoHeight));
const { data } = probe.getContext("2d").getImageData(0, 0, probe.width, probe.height);
let minX = probe.width;
let minY = probe.height;
let maxX = 0;
let maxY = 0;
for (let y = 0; y < probe.height; y++) {
  for (let x = 0; x < probe.width; x++) {
    if (data[(y * probe.width + x) * 4 + 3] > 0) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
}
if (maxX <= minX || maxY <= minY) throw new Error("Could not find the mark in the logo.");
const side = Math.max(maxX - minX, maxY - minY) * 1.04;
const cx = (minX + maxX) / 2;
const cy = (minY + maxY) / 2;
const square = (n) => Number(n.toFixed(2));
const mark = markOnly.replace(
  /<svg[^>]*>/,
  `<svg width="${square(side)}" height="${square(side)}" viewBox="${square(cx - side / 2)} ${square(cy - side / 2)} ${square(side)} ${square(side)}" fill="none" xmlns="http://www.w3.org/2000/svg">`,
);
await writeFile(path.join(root, "public", "brand", "icon.svg"), mark);
await writeFile(path.join(root, "public", "brand", "icon.png"), await (await render(mark, 64, 64)).encode("png"));

// favicon.ico: ICO with PNG compression (16, 32, 48 px).
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map(async (size) => (await render(mark, size, size)).encode("png")));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, i) => {
  const entry = 6 + 16 * i;
  header.writeUInt8(size, entry);
  header.writeUInt8(size, entry + 1);
  header.writeUInt8(0, entry + 2);
  header.writeUInt8(0, entry + 3);
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[i].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[i].length;
});
await writeFile(path.join(root, "src", "app", "favicon.ico"), Buffer.concat([header, ...images]));
console.log(`Logo assets generated (logo ${logoWidth} × ${logoHeight}).`);
