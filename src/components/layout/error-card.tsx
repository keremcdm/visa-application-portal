import type { ReactNode } from "react";
import { cn } from "@/components/ui/primitives";
import { figtree } from "@/lib/fonts/figtree";

/*
 * ERROR AND "NOT FOUND" SCREENS
 * Centered card: the code inside two nested circles (navy; red for a general error), title, description, full-width buttons,
 * and a small error code line at the bottom if present. Texts are the app's own texts (src/lib/site.ts).
 */

export const ERROR_PRIMARY =
  "inline-flex h-[50px] flex-[1_1_180px] items-center justify-center whitespace-nowrap rounded-full bg-dash-navy px-6 text-[15px] font-bold text-white transition-colors hover:bg-dash-navy-hover";

export function ErrorCard({
  code,
  tone = "navy",
  title,
  children,
  actions,
  footnote,
}: {
  /** Code inside the circle ("404", "403", "!") or an icon. */
  code: ReactNode;
  tone?: "navy" | "red";
  title: string;
  children: ReactNode;
  actions: ReactNode;
  footnote?: ReactNode;
}) {
  const long = typeof code === "string" && code.length > 1;
  return (
    <section
      role={tone === "red" ? "alert" : undefined}
      className={cn(
        figtree.variable,
        "dash-root mx-auto flex w-full max-w-[520px] flex-col items-center gap-[22px] rounded-[28px] border border-dash-line-soft bg-white px-6 pb-8 pt-10 text-center font-dash text-dash-ink sm:px-10 sm:pb-10 sm:pt-12",
      )}
    >
      <div aria-hidden className={cn("flex size-[132px] items-center justify-center rounded-full", tone === "red" ? "bg-dash-red-tint" : "bg-dash-navy-tint")}>
        <span
          className={cn(
            "flex size-24 items-center justify-center rounded-full font-extrabold tracking-[-0.02em] text-white",
            tone === "red" ? "bg-dash-red" : "bg-dash-navy",
            long ? "text-[30px]" : "text-[40px]",
          )}
        >
          {code}
        </span>
      </div>
      <div className="flex flex-col gap-2.5">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-[-0.02em]">{title}</h1>
        <div className="text-[15px] leading-[1.6] text-dash-ink-2 [text-wrap:pretty]">{children}</div>
      </div>
      <div className="flex w-full flex-wrap gap-2.5">{actions}</div>
      {footnote ? <p className="text-xs text-dash-ink-4">{footnote}</p> : null}
    </section>
  );
}
