import { AccessNotice } from "@/components/layout/access-notice";
import { NOT_FOUND_PAGE, ROUTES } from "@/lib/site";

/** Records in the customer panel that were not found or belong to someone else; shown inside the panel frame. */
export default function CustomerNotFound() {
  return (
    <AccessNotice title={NOT_FOUND_PAGE.title} homeHref={ROUTES.customer}>
      {NOT_FOUND_PAGE.description}
    </AccessNotice>
  );
}
