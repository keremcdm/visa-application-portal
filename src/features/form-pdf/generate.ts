import { pruneFormData } from "@/features/application-form/engine";
import type { FormData } from "@/features/application-form/types";
import type { ApplicationType } from "@/lib/domain/constants";
import { formatDateTimeTr } from "@/lib/validation/formats";
import { fillTemplate, type FillResult } from "./layout-engine";
import { buildUkInfoFormPlacements, UK_INFO_FORM_TEMPLATE_FILE, type TemplateBuild } from "./templates/uk-info-form";

/**
 * FORM TEMPLATE REGISTRY
 *
 * To add a new template:
 *  1. Put the blank PDF into the `assets/form-templates/` folder.
 *  2. Extract the coordinates with `npm run pdf:inspect` and write a mapping file under `templates/`.
 *  3. Add it to the registry below and specify in `templateForApplication` which application type uses it.
 *
 * Currently the only template received from the company is the UK information form, used for all application types.
 * A converter for DOCX templates has not been written yet.
 */
export type FormTemplateId = "uk-info-form";

export type FormTemplate = {
  id: FormTemplateId;
  label: string;
  /** File name under assets/form-templates. */
  file: string;
  /** Name of the file inside the ZIP and when downloaded. */
  outputFileName: string;
  build: (prunedFormData: FormData) => TemplateBuild;
};

export const FORM_TEMPLATES: Record<FormTemplateId, FormTemplate> = {
  "uk-info-form": {
    id: "uk-info-form",
    label: "İngiltere Bilgi Formu",
    file: UK_INFO_FORM_TEMPLATE_FILE,
    outputFileName: "Doldurulmus_Basvuru_Formu.pdf",
    build: buildUkInfoFormPlacements,
  },
};

// All application types use the same template; the parameter will be used once type-specific templates are added.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function templateForApplication(_applicationTypes: readonly ApplicationType[]): FormTemplate {
  return FORM_TEMPLATES["uk-info-form"];
}

export type FormPdfAssets = { template: Uint8Array; regularFont: Uint8Array; boldFont: Uint8Array };

export type GenerateFormPdfInput = {
  template: FormTemplate;
  assets: FormPdfAssets;
  /** Raw form data; hidden fields are cleared here. */
  formData: FormData;
  referenceCode: string;
  generatedAt: Date;
};

function applicantName(formData: FormData): string {
  const personal = formData.personal ?? {};
  const first = typeof personal.firstName === "string" ? personal.firstName : "";
  const last = typeof personal.lastName === "string" ? personal.lastName : "";
  return `${first} ${last}`.trim();
}

export async function generateFormPdf(input: GenerateFormPdfInput): Promise<FillResult> {
  const pruned = pruneFormData(input.formData);
  const { placements, extraEntries } = input.template.build(pruned);
  const name = applicantName(pruned);
  const stamp = formatDateTimeTr(input.generatedAt);
  return fillTemplate({
    template: input.assets.template,
    regularFont: input.assets.regularFont,
    boldFont: input.assets.boldFont,
    placements,
    extraEntries,
    // Kept short: it must not run into the logo at the bottom of the last page (x ≥ 219).
    footer: `Başvuru no: ${input.referenceCode}  ·  Oluşturulma: ${stamp}`,
    appendixSubtitle: `Başvuru no: ${input.referenceCode}${name ? `  ·  Başvuru sahibi: ${name}` : ""}`,
    title: `${input.template.label}${name ? ` – ${name}` : ""}`,
  });
}
