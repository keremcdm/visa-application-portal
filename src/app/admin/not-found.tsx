import { AccessNotice } from "@/components/layout/access-notice";
import { NOT_FOUND_PAGE, ROUTES } from "@/lib/site";

/** Records not found in the admin panel; shown inside the panel frame. */
export default function StaffNotFound() {
  return (
    <AccessNotice title={NOT_FOUND_PAGE.title} homeHref={ROUTES.staff}>
      {NOT_FOUND_PAGE.description}
    </AccessNotice>
  );
}
