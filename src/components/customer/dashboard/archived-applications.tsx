"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/components/ui/primitives";

export type ArchivedApplicationItem = {
  id: string;
  href: string;
  referenceCode: string;
  applicantName: string | null;
  typeText: string;
  /** Outcome: approved, refused, cancelled (just "Sonuçlandı" (concluded) if there is no outcome record). */
  outcome: "approved" | "refused" | "cancelled" | "finished";
  /** "28.09.2026" */
  finishedText: string;
};

const OUTCOME: Record<ArchivedApplicationItem["outcome"], { label: string; className: string }> = {
  approved: { label: "Onaylandı", className: "bg-dash-green-tint text-dash-green-ink" },
  refused: { label: "Reddedildi", className: "bg-dash-red-tint text-dash-red" },
  cancelled: { label: "İptal edildi", className: "bg-dash-subtle text-dash-ink-2" },
  finished: { label: "Sonuçlandı", className: "bg-dash-subtle text-dash-ink-2" },
};

/**
 * Past applications: applications concluded or cancelled about two weeks
 * ago leave the navy card and are kept here, in a section that is closed by default.
 * It opens with a horizontal line reading "Eski başvuruları göster (n)" (show past applications) in the middle.
 */
export function ArchivedApplications({ items }: { items: ArchivedApplicationItem[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <section aria-label="Eski başvurular" className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <span aria-hidden className="h-px flex-1 bg-dash-line-strong" />
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((value) => !value)}
          className="flex flex-none items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold text-dash-ink-2 hover:bg-dash-subtle hover:text-dash-navy"
        >
          {open ? "Eski başvuruları gizle" : `Eski başvuruları göster (${items.length})`}
          <ChevronDown aria-hidden className={cn("size-4 transition-transform motion-reduce:transition-none", open && "rotate-180")} strokeWidth={2.5} />
        </button>
        <span aria-hidden className="h-px flex-1 bg-dash-line-strong" />
      </div>
      {open ? (
        <ul id={listId} className="flex flex-col gap-3">
          {items.map((item) => {
            const outcome = OUTCOME[item.outcome];
            return (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-5 rounded-[22px] border border-dash-line bg-white px-6 py-5">
                <div className="flex min-w-0 flex-col gap-[5px]">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="text-base font-bold">{item.referenceCode}</span>
                    <span className={cn("rounded-full px-2.5 py-[3px] text-xs font-bold", outcome.className)}>{outcome.label}</span>
                  </div>
                  <span className="text-sm leading-[1.45] text-dash-ink-2">{[item.applicantName, item.typeText].filter(Boolean).join(" · ")}</span>
                  <span className="text-[13px] text-dash-ink-3">
                    {item.outcome === "cancelled" ? "İptal tarihi" : "Sonuç tarihi"}: {item.finishedText}
                  </span>
                </div>
                <Link
                  href={item.href}
                  className="flex h-11 flex-none items-center rounded-full border-[1.5px] border-dash-line-strong bg-white px-[22px] text-[15px] font-bold text-dash-navy hover:bg-dash-subtle"
                >
                  Görüntüle
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
