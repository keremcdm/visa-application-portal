// Generates SYNTHETIC files for browser testing into the test-files/ folder.
// Contains no real person or document; real passports, receipts etc. are NEVER used for testing.
// Usage: node scripts/generate-test-files.mjs
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "test-files");
await mkdir(out, { recursive: true });

async function pdf(title, lines) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  page.drawText("TEST - SYNTHETIC DOCUMENT - NOT A REAL PERSON", { x: 50, y: 790, size: 12, font: bold, color: rgb(0.78, 0.15, 0.21) });
  page.drawText(title, { x: 50, y: 750, size: 20, font: bold, color: rgb(0.1, 0.13, 0.31) });
  lines.forEach((line, i) => page.drawText(line, { x: 50, y: 710 - i * 22, size: 12, font }));
  return Buffer.from(await doc.save());
}

function image(title, type) {
  const canvas = createCanvas(800, 520);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#F6F5F1";
  ctx.fillRect(0, 0, 800, 520);
  ctx.fillStyle = "#19214F";
  ctx.font = "bold 40px sans-serif";
  ctx.fillText(title, 40, 120);
  ctx.fillStyle = "#C72635";
  ctx.font = "bold 24px sans-serif";
  ctx.fillText("TEST - SYNTHETIC IMAGE", 40, 180);
  return canvas.encode(type);
}

const files = {
  "test-passport.pdf": await pdf("Passport (test)", ["Name: TEST USER", "Passport no: TEST000000", "Valid until: 01.01.2030"]),
  "test-bank-statement.pdf": await pdf("Bank statement (test)", ["Account holder: TEST USER", "Balance: 0.00 TRY (sample)"]),
  "test-student-certificate.pdf": await pdf("Student certificate (test)", ["School: SAMPLE UNIVERSITY", "Student: TEST USER"]),
  "test-receipt.pdf": await pdf("Transfer receipt (test)", ["Reference: VB-2026-000000", "Amount: sample"]),
  "test-photo.jpg": await image("Photo (test)", "jpeg"),
  "test-document.png": await image("Document (test)", "png"),
  "test-visa-result.png": await image("Visa result (test)", "png"),
};
// A valid PDF that exceeds the size limit (10 MB).
files["large-file-11mb.pdf"] = Buffer.concat([files["test-passport.pdf"], Buffer.alloc(11 * 1024 * 1024, 0x20)]);
// A file with a PDF extension but non-PDF content (the content check must reject it).
files["fake-pdf.pdf"] = Buffer.from("This file is not a PDF; only its extension was changed to .pdf.\n", "utf8");
// A file type that is not allowed.
files["unsupported-type.docx"] = Buffer.from("Not a Word file; tests a disallowed extension.\n", "utf8");

for (const [name, content] of Object.entries(files)) await writeFile(path.join(out, name), content);
console.log(`${Object.keys(files).length} test files written to test-files/.`);
