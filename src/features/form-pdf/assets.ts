import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FormPdfAssets, FormTemplate } from "./generate";

const ASSET_ROOT = path.join(process.cwd(), "assets");

const cache = new Map<string, Promise<FormPdfAssets>>();

/** Reads the template PDF and fonts from disk; keeps them in memory for the life of the process. */
export function loadFormPdfAssets(template: FormTemplate): Promise<FormPdfAssets> {
  let pending = cache.get(template.id);
  if (!pending) {
    pending = (async () => {
      const [templateBytes, regularFont, boldFont] = await Promise.all([
        readFile(path.join(ASSET_ROOT, "form-templates", template.file)),
        readFile(path.join(ASSET_ROOT, "fonts", "LiberationSans-Regular.ttf")),
        readFile(path.join(ASSET_ROOT, "fonts", "LiberationSans-Bold.ttf")),
      ]);
      return {
        template: new Uint8Array(templateBytes),
        regularFont: new Uint8Array(regularFont),
        boldFont: new Uint8Array(boldFont),
      };
    })();
    // If reading fails, it can be retried on the next request.
    pending.catch(() => cache.delete(template.id));
    cache.set(template.id, pending);
  }
  return pending;
}
