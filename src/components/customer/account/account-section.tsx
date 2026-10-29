"use client";

import { useId, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/components/ui/primitives";

/*
 * PARTS OF THE MY ACCOUNT PAGE
 * Each section is a card: icon in a grey circle on the left, title and description. When closed, a summary of the current
 * value and "Düzenle" (edit); when open, the form and "Vazgeç" (cancel). The "Hesabı sil" section is always open.
 */

export function AccountSection({
  icon,
  title,
  description,
  summary,
  notice,
  danger = false,
  collapsible = true,
  children,
}: {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  /** Summary of the current value shown when closed. */
  summary?: ReactNode;
  /** Note shown under the title whether open or closed (e.g. an e-mail awaiting confirmation). */
  notice?: ReactNode;
  danger?: boolean;
  collapsible?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(!collapsible);
  const headingId = `${id}-heading`;
  const bodyId = `${id}-content`;

  return (
    <section
      aria-labelledby={headingId}
      className={cn("flex min-w-0 flex-col rounded-[24px] border bg-white px-5 py-6 sm:px-7", danger ? "border-dash-red-border" : "border-dash-line-soft")}
    >
      <div className="flex flex-wrap items-center gap-4">
        <span
          aria-hidden
          className={cn("flex size-11 flex-none items-center justify-center rounded-full", danger ? "bg-dash-red-tint text-dash-red" : "bg-dash-subtle text-dash-navy")}
        >
          {icon}
        </span>
        <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-1">
          <h2 id={headingId} className="text-lg font-extrabold">
            {title}
          </h2>
          {description ? <p className="text-[13px] leading-[1.55] text-dash-ink-2 [text-wrap:pretty]">{description}</p> : null}
          {summary && !open ? <p className="mt-1.5 truncate text-[15px] font-bold">{summary}</p> : null}
        </div>
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={bodyId}
            className="h-9 flex-none whitespace-nowrap rounded-full border-[1.5px] border-dash-field bg-white px-4 text-[13px] font-bold text-dash-navy transition-colors motion-reduce:transition-none hover:bg-dash-subtle"
          >
            {open ? "Vazgeç" : "Düzenle"}
            <span className="sr-only">: {title}</span>
          </button>
        ) : null}
      </div>
      {notice ? <div className="mt-4">{notice}</div> : null}
      {open ? (
        <div id={bodyId} className="mt-5 flex flex-col gap-5 border-t border-dash-line-soft pt-[22px]">
          {children}
        </div>
      ) : null}
    </section>
  );
}

/** Green confirmation pill shown next to the button after saving; the text is the app's own success message. */
export function SavedPill({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="inline-flex max-w-full items-start gap-1.5 rounded-[15px] bg-dash-green-tint px-3 py-1.5 text-[13px] font-bold leading-snug text-dash-green-deep">
      <Check aria-hidden className="mt-0.5 size-3 flex-none" strokeWidth={3.5} />
      <span>{children}</span>
    </p>
  );
}
