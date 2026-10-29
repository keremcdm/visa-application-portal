import type { ReactNode } from "react";
import { cn } from "@/components/ui/primitives";
import type { AdminTone } from "@/features/staff/admin-state";

/*
 * SHARED PARTS OF THE ADMIN PANEL
 * Pill buttons (primary: solid navy; secondary: white + grey border; danger: red; ghost: transparent text),
 * labels in six tones, cards with 22px corners. Colors come from the dash-* tokens in globals.css.
 */

export type AdminButtonVariant = "primary" | "secondary" | "danger" | "dangerOutline" | "ghost" | "ghostDanger";
export type AdminButtonSize = "lg" | "md" | "sm" | "xs";

const VARIANTS: Record<AdminButtonVariant, string> = {
  primary: "border-0 bg-dash-navy text-white hover:bg-dash-navy-hover hover:text-white",
  secondary: "border-[1.5px] border-dash-line-strong bg-white text-dash-navy hover:bg-dash-subtle hover:text-dash-navy",
  danger: "border-0 bg-dash-red text-white hover:bg-dash-red-hover hover:text-white",
  dangerOutline: "border-[1.5px] border-dash-red-border bg-white text-dash-red hover:bg-dash-red-tint hover:text-dash-red",
  ghost: "border-0 bg-transparent text-dash-navy hover:bg-dash-subtle hover:text-dash-navy",
  ghostDanger: "border-0 bg-transparent text-dash-red hover:bg-dash-red-tint hover:text-dash-red",
};

const SIZES: Record<AdminButtonSize, string> = {
  lg: "h-11 px-5 text-sm",
  md: "h-10 px-4 text-sm",
  sm: "h-[34px] px-3.5 text-[13px]",
  xs: "h-8 px-3 text-[13px]",
};

export function adminButton(variant: AdminButtonVariant = "primary", size: AdminButtonSize = "lg", className?: string): string {
  return cn(
    "inline-flex flex-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-bold no-underline transition-colors disabled:cursor-default disabled:opacity-45 motion-reduce:transition-none",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export const TONE_CLASSES: Record<AdminTone, string> = {
  navy: "bg-dash-navy-tint text-dash-navy",
  solid: "bg-dash-navy text-white",
  yellow: "bg-dash-draft-bg text-dash-draft-ink",
  green: "bg-dash-green-tint text-dash-green-ink",
  red: "bg-dash-red-tint text-dash-red",
  gray: "bg-dash-subtle text-dash-ink-2",
};

/** Status label (pill): 12px bold, one of six tones. */
export function AdminPill({ tone, children, size = "md", className }: { tone: AdminTone; children: ReactNode; size?: "md" | "sm"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full text-xs font-bold",
        size === "md" ? "px-[11px] py-[5px]" : "px-2.5 py-1",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** White card: 22px corners, thin border, no shadow. */
export function AdminCard({ children, className, as = "section", ...rest }: { children: ReactNode; className?: string; as?: "section" | "div"; "aria-labelledby"?: string }) {
  const Tag = as;
  return (
    <Tag className={cn("flex flex-col rounded-[22px] border border-dash-line bg-white px-6 py-[22px]", className)} {...rest}>
      {children}
    </Tag>
  );
}

/** Small upper-case label ("SIRADAKİ İŞ", "BAŞVURU" …). */
export function AdminEyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("text-xs font-bold tracking-[0.08em] text-dash-ink-3", className)}>{children}</span>;
}

/** Info / error / success box (14px corners). */
export function AdminNote({ tone = "info", children, className, role }: { tone?: "info" | "error" | "success" | "warning"; children: ReactNode; className?: string; role?: "status" | "alert" }) {
  const tones = {
    info: "bg-dash-subtle text-dash-ink-2",
    error: "bg-dash-red-tint text-dash-red",
    success: "bg-dash-green-tint text-dash-green-ink",
    warning: "bg-dash-draft-bg text-dash-draft-ink",
  } as const;
  return (
    <div role={role} className={cn("rounded-[14px] px-3.5 py-3 text-[13px] leading-normal", tones[tone], className)}>
      {children}
    </div>
  );
}
