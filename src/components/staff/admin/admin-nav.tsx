"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { cn } from "@/components/ui/primitives";
import { ROUTES } from "@/lib/site";

const ITEMS = [
  { href: ROUTES.staff, label: "Başvurular", match: (path: string) => path === ROUTES.staff || path.startsWith(`${ROUTES.staff}/applications`) },
  { href: ROUTES.staffSettings, label: "Ayarlar", match: (path: string) => path.startsWith(ROUTES.staffSettings) },
];

/**
 * Pill links in the top bar; the current section has a grey background and bold text.
 * The address is only known at request time: the bar is first drawn without highlight, the current section is marked right after.
 */
export function AdminNav() {
  return (
    <Suspense fallback={<NavLinks pathname={null} />}>
      <CurrentNav />
    </Suspense>
  );
}

function CurrentNav() {
  return <NavLinks pathname={usePathname()} />;
}

function NavLinks({ pathname }: { pathname: string | null }) {
  return (
    <nav aria-label="Yönetim paneli" className="flex gap-1">
      {ITEMS.map((item) => {
        const active = pathname !== null && item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-full px-3.5 py-2 text-sm no-underline transition-colors motion-reduce:transition-none",
              active ? "bg-dash-subtle font-bold text-dash-navy hover:text-dash-navy" : "font-semibold text-dash-ink-2 hover:bg-dash-subtle hover:text-dash-navy",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
