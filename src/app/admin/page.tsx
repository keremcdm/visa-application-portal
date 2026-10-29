import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { ApplicationsList } from "@/components/staff/admin/applications-list";
import { adminButton } from "@/components/staff/admin/ui";
import { DeletionRequestRow } from "@/components/staff/deletion-requests";
import { formatDateTimeTr } from "@/lib/validation/formats";
import { completePastAppointments } from "@/server/appointment-completion";
import { requireStaff } from "@/server/auth";
import { loadPendingDeletionRequests } from "@/server/data/account";
import { loadAdminList, parseAdminListFilters } from "@/server/data/admin-list";
import { loadOwnRecoveryCodeStatus } from "@/server/data/staff";
import { ROUTES } from "@/lib/site";

export const metadata: Metadata = { title: "Başvurular" };

async function ApplicationList({ searchParams }: Pick<PageProps<"/admin">, "searchParams">) {
  const filters = parseAdminListFilters(await searchParams);
  // Past appointments are marked "Randevu gerçekleşti" before the list is read (after authorization).
  await requireStaff();
  await completePastAppointments();
  const result = await loadAdminList(filters);
  return <ApplicationsList filters={filters} result={result} />;
}

/** Reminder for staff without a recovery code. */
async function RecoveryCodeReminder() {
  const recovery = await loadOwnRecoveryCodeStatus();
  if (recovery.status !== "ok" || recovery.createdAt) return null;
  return (
    <section
      aria-labelledby="recovery-code-notice"
      className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-[22px] border-[1.5px] border-dash-yellow-border bg-dash-yellow-row px-6 py-[18px]"
    >
      <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1">
        <h2 id="recovery-code-notice" className="text-base font-extrabold">
          İki adımlı doğrulama yedek kodunuz yok
        </h2>
        <p className="text-sm leading-[1.6] text-dash-ink-2">
          Telefonunuzu kaybederseniz giriş yapabilmek için bir yedek kod oluşturup güvenli bir yere kaydediniz.
        </p>
      </div>
      <Link href={`${ROUTES.staffSettings}?section=staff`} className={adminButton("primary", "md")}>
        Yedek kod oluştur
      </Link>
    </section>
  );
}

/** Pending account deletion requests (only shown if any). Customers with a submitted application send a request. */
async function DeletionRequests() {
  const requests = await loadPendingDeletionRequests();
  if (requests.length === 0) return null;
  return (
    <section aria-labelledby="deletion-requests" className="flex flex-col gap-3 rounded-[22px] border border-dash-red-border bg-white px-6 py-[22px]">
      <h2 id="deletion-requests" className="text-lg font-extrabold tracking-[-0.02em]">
        Hesap silme talepleri ({requests.length})
      </h2>
      <p className="text-[15px] leading-[1.6] text-dash-ink-2">
        Gönderilmiş başvurusu olan müşteriler hesaplarının silinmesini istedi. Hesabı silebilir veya gerekçesini yazarak talebi reddedebilirsiniz; iki
        işlem de hemen uygulanır.
      </p>
      <ul className="flex flex-col gap-3">
        {requests.map((request) => (
          <DeletionRequestRow
            key={request.id}
            item={{
              id: request.id,
              createdAtText: formatDateTimeTr(request.createdAt),
              customerName: request.customerName,
              customerEmail: request.customerEmail,
              submittedCount: request.submittedCount,
              draftCount: request.draftCount,
            }}
          />
        ))}
      </ul>
    </section>
  );
}

/** After returning to the list once an application has been deleted. */
async function DeletedNotice({ searchParams }: Pick<PageProps<"/admin">, "searchParams">) {
  const params = await searchParams;
  if (params.deleted !== "1") return null;
  return (
    <p role="status" className="rounded-[18px] bg-dash-green-tint px-5 py-3.5 text-sm font-semibold text-dash-green-ink">
      Başvuru kalıcı olarak silindi.
    </p>
  );
}

/** While loading: skeletons for tabs, filters and rows (same radius and height). */
function ListSkeleton() {
  return (
    <div className="flex flex-col gap-[22px]" aria-busy="true" aria-label="Başvurular yükleniyor">
      <div className="flex flex-wrap gap-2">
        {[120, 170, 130, 220, 120].map((w, i) => (
          <span key={i} className="h-11 rounded-full bg-dash-subtle" style={{ width: w }} />
        ))}
      </div>
      <span className="h-11 rounded-full bg-dash-subtle" />
      <div className="overflow-hidden rounded-[22px] border border-dash-line bg-white">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex gap-4 border-b border-dash-line-faint px-6 py-4 last:border-b-0">
            <span className="h-[66px] flex-1 rounded-[14px] bg-dash-subtle" />
            <span className="hidden h-[66px] w-[220px] rounded-[14px] bg-dash-subtle min-[1200px]:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function StaffHomePage({ searchParams }: PageProps<"/admin">) {
  return (
    <div className="flex flex-col gap-[22px]">
      <h1 className="text-[30px] font-extrabold tracking-[-0.02em]">Başvurular</h1>
      <Suspense fallback={null}>
        <DeletedNotice searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={null}>
        <RecoveryCodeReminder />
      </Suspense>
      <Suspense fallback={null}>
        <DeletionRequests />
      </Suspense>
      <Suspense fallback={<ListSkeleton />}>
        <ApplicationList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
