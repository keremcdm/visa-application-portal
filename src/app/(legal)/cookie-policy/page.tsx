import type { Metadata } from "next";
import { LegalDocument } from "@/components/layout/legal-document";
import { COOKIE_POLICY } from "@/content/legal/cookie-policy";
import { COOKIE_INVENTORY_BLOCKS } from "@/content/legal/cookie-inventory";

export const metadata: Metadata = { title: "Çerez Politikası" };

export default function CookiePolicyPage() {
  // The portal's actual cookie inventory (cookie-inventory.ts) in place of the legal counsel's "technical verification" field.
  return <LegalDocument title="Çerez Politikası" content={COOKIE_POLICY} extraBlocks={COOKIE_INVENTORY_BLOCKS} />;
}
