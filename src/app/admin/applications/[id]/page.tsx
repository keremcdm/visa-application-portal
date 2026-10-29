import type { Metadata } from "next";
import { Suspense } from "react";
import { ApplicationDetailView, detailTab } from "@/components/staff/admin/application-detail";
import { completePastAppointments } from "@/server/appointment-completion";
import { requireStaff } from "@/server/auth";
import { loadStaffApplication } from "@/server/data/staff";

export const metadata: Metadata = { title: "Başvuru ayrıntısı" };

async function Content({ params, searchParams }: Pick<PageProps<"/admin/applications/[id]">, "params" | "searchParams">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  // Past appointments are marked "Randevu gerçekleşti" (appointment took place) before the page is read (after authorization).
  await requireStaff();
  await completePastAppointments();
  const detail = await loadStaffApplication(id);
  return <ApplicationDetailView detail={detail} tab={detailTab(query.tab)} />;
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Başvuru yükleniyor">
      <span className="h-[86px] rounded-[22px] bg-dash-subtle" />
      <span className="h-11 rounded-full bg-dash-subtle" />
      <div className="grid gap-12 min-[1000px]:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex flex-col gap-4">
          <span className="h-[280px] rounded-[22px] bg-dash-subtle" />
          <span className="h-[52px] rounded-[18px] bg-dash-subtle" />
          <span className="h-[52px] rounded-[18px] bg-dash-subtle" />
        </div>
        <span className="h-[360px] rounded-[22px] bg-dash-subtle" />
      </div>
    </div>
  );
}

export default function StaffApplicationPage({ params, searchParams }: PageProps<"/admin/applications/[id]">) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}
