import type { Metadata } from "next";
import { LegalDocument } from "@/components/layout/legal-document";
import { APPLICATION_TERMS } from "@/content/legal/application-terms";

export const metadata: Metadata = { title: "Başvuru Hizmet Şartları ve Onay Beyanı" };

/** The terms the customer accepts when submitting an application. */
export default function ApplicationTermsPage() {
  return <LegalDocument title="Başvuru Hizmet Şartları ve Onay Beyanı" content={APPLICATION_TERMS} />;
}
