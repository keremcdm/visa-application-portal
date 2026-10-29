import type { Metadata } from "next";
import { PublicNoticePage } from "@/components/layout/access-notice";
import { ERROR_PAGES } from "@/lib/site";

const PAGE = ERROR_PAGES.record;

export const metadata: Metadata = { title: PAGE.title };

export default function RecordErrorPage() {
  return (
    <PublicNoticePage title={PAGE.title} code="404">
      {PAGE.description}
    </PublicNoticePage>
  );
}
