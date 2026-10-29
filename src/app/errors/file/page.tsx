import type { Metadata } from "next";
import { FileX } from "lucide-react";
import { PublicNoticePage } from "@/components/layout/access-notice";
import { ERROR_PAGES } from "@/lib/site";

const PAGE = ERROR_PAGES.file;

export const metadata: Metadata = { title: PAGE.title };

export default function FileErrorPage() {
  return (
    <PublicNoticePage title={PAGE.title} code={<FileX aria-hidden className="size-10" strokeWidth={2.5} />}>
      {PAGE.description}
    </PublicNoticePage>
  );
}
