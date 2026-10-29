import type { Metadata } from "next";
import { AdminShell } from "@/components/staff/admin/admin-shell";
import { requireStaff } from "@/server/auth";

export const metadata: Metadata = { title: { default: "Yönetim paneli", template: "%s | Yönetim paneli" } };

async function StaffEmail() {
  // Users who are not staff are redirected from here to the customer panel.
  const user = await requireStaff();
  return <span className="hidden text-[13px] text-dash-ink-2 md:inline">{user.email}</span>;
}

export default function StaffLayout({ children }: LayoutProps<"/admin">) {
  return <AdminShell userSlot={<StaffEmail />}>{children}</AdminShell>;
}
