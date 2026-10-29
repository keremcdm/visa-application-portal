import type { Metadata } from "next";
import { PublicNoticePage } from "@/components/layout/access-notice";
import { NOT_FOUND_PAGE } from "@/lib/site";

export const metadata: Metadata = { title: NOT_FOUND_PAGE.title };

/** Addresses that match no route, and notFound() calls outside the panels. */
export default function NotFound() {
  return <PublicNoticePage title={NOT_FOUND_PAGE.title}>{NOT_FOUND_PAGE.description}</PublicNoticePage>;
}
