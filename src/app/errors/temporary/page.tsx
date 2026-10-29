import type { Metadata } from "next";
import { PublicNoticePage } from "@/components/layout/access-notice";
import { ERROR_PAGES } from "@/lib/site";

const PAGE = ERROR_PAGES.temporary;

export const metadata: Metadata = { title: PAGE.title };

export default function TemporaryErrorPage() {
  return (
    <PublicNoticePage title={PAGE.title} code="!" tone="red">
      {PAGE.description}
    </PublicNoticePage>
  );
}
