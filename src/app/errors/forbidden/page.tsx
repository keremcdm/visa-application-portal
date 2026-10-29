import type { Metadata } from "next";
import { PublicNoticePage } from "@/components/layout/access-notice";
import { ERROR_PAGES } from "@/lib/site";

const PAGE = ERROR_PAGES.forbidden;

export const metadata: Metadata = { title: PAGE.title };

export default function ForbiddenErrorPage() {
  return (
    <PublicNoticePage title={PAGE.title} code="403">
      {PAGE.description}
    </PublicNoticePage>
  );
}
