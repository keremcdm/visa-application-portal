import { AccessNotice } from "@/components/layout/access-notice";
import { NOT_FOUND_PAGE, ROUTES } from "@/lib/site";

/** Applications that were not found or belong to someone else; shown inside the panel frame. */
export default function ApplicationNotFound() {
  return (
    <main id="content" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      <AccessNotice title={NOT_FOUND_PAGE.title} homeHref={ROUTES.customer}>
        {NOT_FOUND_PAGE.description}
      </AccessNotice>
    </main>
  );
}
