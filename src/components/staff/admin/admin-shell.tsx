import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Logo } from "@/components/layout/site-chrome";
import { cn } from "@/components/ui/primitives";
import { figtree } from "@/lib/fonts/figtree";
import { LEGAL_FOOTER_LINKS, ROUTES, SITE } from "@/lib/site";
import { signOutAction } from "@/server/actions/auth";
import { AdminNav } from "./admin-nav";
import { adminButton } from "./ui";

/**
 * ADMIN PANEL FRAME
 * White 68px top bar (logo, "Yönetim paneli", Başvurular / Ayarlar, the staff member's e-mail, Çıkış),
 * warm grey background and footer. Older shared components in scope take on the same language via `.admin-root` (globals.css).
 */
export function AdminShell({ userSlot, children }: { userSlot: ReactNode; children: ReactNode }) {
  return (
    <div className={cn(figtree.variable, "admin-root dash-root flex min-h-full flex-1 flex-col bg-dash-canvas font-dash text-dash-navy")}>
      <header className="no-print border-b border-dash-line bg-white">
        <div className="mx-auto flex min-h-[68px] w-full max-w-[1200px] flex-wrap items-center gap-x-[18px] gap-y-2 px-4 py-2 sm:px-10">
          <span>
            <Logo href={ROUTES.staff} height={34} />
          </span>
          <span aria-hidden className="hidden h-6 w-px bg-dash-line sm:block" />
          <span className="hidden text-sm text-dash-ink-2 sm:inline">Yönetim paneli</span>
          <div className="sm:ml-2.5">
            <AdminNav />
          </div>
          <div className="ml-auto flex items-center gap-[18px]">
            <Suspense fallback={<span aria-hidden className="h-4 w-40 rounded-full bg-dash-subtle" />}>{userSlot}</Suspense>
            <form action={signOutAction}>
              <button type="submit" className={adminButton("secondary", "md")}>
                Çıkış
              </button>
            </form>
          </div>
        </div>
      </header>
      <main id="content" className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col px-4 pb-16 pt-8 sm:px-10">
        {children}
      </main>
      <footer className="no-print border-t border-dash-line bg-white">
        <div className="mx-auto flex min-h-16 w-full max-w-[1200px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-[13px] text-dash-ink-2 sm:px-10">
          <span className="mr-auto">{SITE.companyName}</span>
          {LEGAL_FOOTER_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="text-dash-ink-2 no-underline hover:text-dash-navy">
              {link.title}
            </Link>
          ))}
        </div>
      </footer>
    </div>
  );
}
