import type { Metadata } from "next";
import { LegalDocument } from "@/components/layout/legal-document";
import { RETENTION_POLICY } from "@/content/legal/data-retention";

export const metadata: Metadata = { title: "Veri Saklama ve İmha Politikası" };

export default function RetentionPolicyPage() {
  return <LegalDocument title="Veri Saklama ve İmha Politikası" content={RETENTION_POLICY} />;
}
