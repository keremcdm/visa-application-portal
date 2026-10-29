import type { Metadata } from "next";
import { LegalDocument } from "@/components/layout/legal-document";
import { KVKK_NOTICE } from "@/content/legal/privacy-notice";

export const metadata: Metadata = { title: "KVKK Aydınlatma Metni" };

export default function KvkkNoticePage() {
  return <LegalDocument title="KVKK Aydınlatma Metni" content={KVKK_NOTICE} />;
}
