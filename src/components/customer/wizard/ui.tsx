import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { AlertCircle, Check, CheckCircle2, Clock, Info, X } from "lucide-react";
import { cn } from "@/components/ui/primitives";
import { DOCUMENT_REQUIREMENT_LABELS, type DocumentRequirement } from "@/lib/domain/constants";

/*
 * LOOK OF THE APPLICATION WIZARD
 * Figtree, `dash-*` colors, white cards with large
 * corners, pill-shaped buttons and status pills with icons. Used only in the application steps (type, form, documents,
 * appointment, fee, summary); it does not spread to other screens. This file contains only presentation:
 * texts and rules live in the components that use it.
 */

// --- Buttons -------------------------------------------------------------------

type WizVariant = "primary" | "secondary" | "danger" | "quiet";
/** xl: submit (50px) · lg: card bottom bar (46px) · md: file upload (42px) · sm: "Düzenle" (34px) · xs: file row (30px). */
type WizSize = "xl" | "lg" | "md" | "row" | "sm" | "xs";

const WIZ_BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-bold transition-colors motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-40";

const WIZ_BUTTON_VARIANTS: Record<WizVariant, string> = {
  primary: "bg-dash-navy text-white hover:bg-dash-navy-hover",
  secondary: "border-[1.5px] border-dash-field bg-white text-dash-navy hover:bg-dash-subtle",
  danger: "bg-dash-red text-white hover:bg-dash-red-hover",
  quiet: "text-dash-ink-2 hover:bg-dash-line-soft hover:text-dash-navy",
};

const WIZ_BUTTON_SIZES: Record<WizSize, string> = {
  xl: "h-[50px] px-7 text-[15px]",
  lg: "h-[46px] px-[22px] text-sm",
  md: "h-[42px] px-[18px] text-sm",
  row: "h-10 px-[18px] text-[13px]",
  sm: "h-[34px] px-3.5 text-[13px]",
  xs: "h-[30px] px-2.5 text-xs",
};

export function wizButtonClass(variant: WizVariant = "primary", size: WizSize = "lg", className?: string): string {
  return cn(WIZ_BUTTON_BASE, WIZ_BUTTON_VARIANTS[variant], WIZ_BUTTON_SIZES[size], className);
}

type WizButtonProps = ComponentProps<"button"> & { variant?: WizVariant; size?: WizSize };

export function WizButton({ variant = "primary", size = "lg", className, type = "button", ...props }: WizButtonProps) {
  return <button type={type} className={wizButtonClass(variant, size, className)} {...props} />;
}

type WizLinkButtonProps = ComponentProps<typeof Link> & { variant?: WizVariant; size?: WizSize };

export function WizLinkButton({ variant = "primary", size = "lg", className, ...props }: WizLinkButtonProps) {
  return <Link className={wizButtonClass(variant, size, className)} {...props} />;
}

// --- Card ----------------------------------------------------------------------

/**
 * The step's white card: top label (if any), title, description and content. Content is written with `WizardBody` and
 * (if any) `WizardFooter`; the bottom bar reaches the card's edges.
 */
export function WizardCard({
  title,
  eyebrow,
  titleExtra,
  description,
  wideDescription = false,
  children,
  className,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  /** Element shown next to the title (e.g. appointment status). */
  titleExtra?: ReactNode;
  description?: ReactNode;
  /** The description uses the full card width (ends aligned with the note box below it). */
  wideDescription?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-[28px] border border-dash-line-soft bg-white", className)}>
      <div className="flex flex-col gap-2.5 px-5 pb-2 pt-8 sm:px-11 sm:pt-10">
        {eyebrow ? <p className="text-[13px] font-semibold text-dash-ink-3">{eyebrow}</p> : null}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[26px] font-extrabold leading-tight tracking-[-0.02em]">{title}</h1>
          {titleExtra}
        </div>
        {description ? (
          <div className={cn("text-sm leading-[1.6] text-dash-ink-2 [text-wrap:pretty]", !wideDescription && "max-w-[720px]")}>{description}</div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function WizardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-7 px-5 pb-10 pt-5 sm:px-11", className)}>{children}</div>;
}

/** Card bottom bar: info (e.g. save state) or "Geri" (back) on the left, progress buttons on the right. */
export function WizardFooter({ start, end }: { start?: ReactNode; end?: ReactNode }) {
  return (
    <div className="mt-auto flex flex-wrap items-center justify-between gap-4 border-t border-dash-line-soft px-5 py-5 sm:pl-11 sm:pr-7">
      <div className="flex min-w-0 flex-wrap items-center gap-2.5">{start}</div>
      <div className="flex flex-wrap items-center gap-2.5">{end}</div>
    </div>
  );
}

/** Small cards on the summary page: title with a link such as "Düzenle" on the right. */
export function SummaryCard({ title, action, children, className }: { title: ReactNode; action?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-4 rounded-[24px] border border-dash-line-soft bg-white px-5 py-6 sm:px-8", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[17px] font-extrabold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// --- Notes ---------------------------------------------------------------------

type NoteTone = "info" | "warning" | "success" | "danger";

const NOTE_TONES: Record<NoteTone, { box: string; icon: typeof Info; iconClass: string }> = {
  info: { box: "bg-dash-canvas text-dash-ink", icon: Info, iconClass: "text-dash-navy" },
  warning: { box: "bg-dash-draft-bg text-dash-warn-ink", icon: AlertCircle, iconClass: "text-dash-draft-ink" },
  success: { box: "bg-dash-green-tint text-dash-green-deep", icon: CheckCircle2, iconClass: "text-dash-green-ink" },
  danger: { box: "bg-dash-red-tint text-dash-red-hover", icon: AlertCircle, iconClass: "text-dash-red" },
};

/** Info, warning, success or error note (a single soft-background box instead of a box inside a box). */
export function WizNote({
  tone = "info",
  title,
  children,
  className,
  role,
  onPage = false,
}: {
  tone?: NoteTone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Pass "alert" for error messages and "status" for status information. */
  role?: "alert" | "status";
  /** When it sits outside a card on the page background: an info note becomes a white box instead of a grey background. */
  onPage?: boolean;
}) {
  const { icon: Icon, iconClass } = NOTE_TONES[tone];
  const box = onPage && tone === "info" ? "border border-dash-line-soft bg-white text-dash-ink" : NOTE_TONES[tone].box;
  return (
    <div role={role} className={cn("flex items-start gap-3 rounded-[18px] px-[18px] py-4 text-sm leading-[1.6] [text-wrap:pretty]", box, className)}>
      <Icon aria-hidden className={cn("mt-[3px] size-[18px] flex-none", iconClass)} strokeWidth={2.75} />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-bold">{title}</p> : null}
        {children ? <div className={title ? "mt-1" : undefined}>{children}</div> : null}
      </div>
    </div>
  );
}

// --- Pills and labels ----------------------------------------------------------

export type PillTone = "done" | "waiting" | "warning" | "neutral" | "info" | "danger";

const PILL_TONES: Record<PillTone, { cls: string; icon: typeof Check | null }> = {
  done: { cls: "bg-dash-green-tint text-dash-green-deep", icon: Check },
  waiting: { cls: "bg-dash-draft-bg text-dash-draft-ink", icon: Clock },
  warning: { cls: "bg-dash-draft-bg text-dash-draft-ink", icon: AlertCircle },
  neutral: { cls: "bg-dash-line-soft text-dash-ink-2", icon: null },
  info: { cls: "bg-dash-navy-tint text-dash-navy", icon: null },
  danger: { cls: "bg-dash-red-tint text-dash-red-hover", icon: AlertCircle },
};

/** Status pill with an icon (Yüklendi, Bekleniyor …). `icon` replaces the tone's default icon. */
export function StatusPill({
  tone,
  children,
  size = "md",
  icon,
  className,
}: {
  tone: PillTone;
  children: ReactNode;
  size?: "md" | "sm";
  icon?: "check" | "clock" | "x";
  className?: string;
}) {
  const { cls, icon: ToneIcon } = PILL_TONES[tone];
  const Icon = icon ? { check: Check, clock: Clock, x: X }[icon] : ToneIcon;
  return (
    <span
      className={cn(
        "inline-flex flex-none items-center whitespace-nowrap rounded-full font-bold",
        size === "md" ? "h-[30px] gap-[7px] text-[13px]" : "h-7 gap-1.5 text-xs",
        Icon ? (size === "md" ? "pl-2.5 pr-[13px]" : "pl-[9px] pr-3") : size === "md" ? "px-[13px]" : "px-3",
        cls,
        className,
      )}
    >
      {Icon ? <Icon aria-hidden className="size-[13px]" strokeWidth={3} /> : null}
      {children}
    </span>
  );
}

const REQUIREMENT_TAGS: Record<DocumentRequirement, string> = {
  required: "bg-dash-red-tint text-dash-red-hover",
  optional: "bg-dash-green-tint text-dash-green-deep",
};

/** The document's requirement label (Zorunlu / İsteğe bağlı: required / optional). */
export function RequirementTag({ requirement }: { requirement: DocumentRequirement }) {
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-bold", REQUIREMENT_TAGS[requirement])}>
      {DOCUMENT_REQUIREMENT_LABELS[requirement]}
    </span>
  );
}

export type ChipTone = "neutral" | "info" | "success" | "warning" | "danger";

const CHIP_TONES: Record<ChipTone, string> = {
  neutral: "bg-dash-line-soft text-dash-ink-2",
  info: "bg-dash-navy-tint text-dash-navy",
  success: "bg-dash-green-tint text-dash-green-deep",
  warning: "bg-dash-draft-bg text-dash-draft-ink",
  danger: "bg-dash-red-tint text-dash-red-hover",
};

/** Small status label next to the title (such as "Taslak": draft). */
export function WizChip({ tone = "neutral", children }: { tone?: ChipTone; children: ReactNode }) {
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-[11px] py-1 text-xs font-bold", CHIP_TONES[tone])}>{children}</span>;
}

/** Soft label showing a selection (e.g. the application types in the summary). */
export function WizTag({ children }: { children: ReactNode }) {
  return <span className="inline-flex h-8 items-center rounded-full bg-dash-line-soft px-3.5 text-[13px] font-bold">{children}</span>;
}

// --- Form fields ---------------------------------------------------------------

/** Accessible field wrapper (same bindings as Field in src/components/ui/form.tsx, with the design's sizes). */
export function WizField({
  id,
  label,
  hint,
  error,
  required,
  labelExtra,
  children,
  className,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  labelExtra?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex items-center gap-1.5">
        <label htmlFor={id} className="text-sm font-semibold text-dash-ink">
          {label}
          {required ? (
            <span className="ml-[3px] text-dash-red" aria-hidden>
              *
            </span>
          ) : null}
        </label>
        {labelExtra}
      </div>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-[13px] leading-normal text-dash-ink-3">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-[13px] font-semibold text-dash-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The design's rounded checkbox and its label. */
export function WizCheckbox({
  id,
  label,
  error,
  className,
  labelClassName,
  ...props
}: Omit<ComponentProps<"input">, "type" | "className"> & { id: string; label: ReactNode; error?: string | null; className?: string; labelClassName?: string }) {
  return (
    <div className={className}>
      <div className="flex items-start gap-3.5">
        <input
          id={id}
          type="checkbox"
          className="wiz-check mt-px"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          {...props}
        />
        <label htmlFor={id} className={cn("text-sm leading-[1.6] text-dash-ink", labelClassName)}>
          {label}
        </label>
      </div>
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-[13px] font-semibold text-dash-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Card placeholder while page data loads. */
export function WizardLoading({ label = "Yükleniyor…", lines = 4 }: { label?: string; lines?: number }) {
  return (
    <div role="status" aria-live="polite" className="rounded-[28px] border border-dash-line-soft bg-white px-5 py-8 sm:px-11 sm:py-10">
      <span className="sr-only">{label}</span>
      <div aria-hidden className="space-y-3">
        <div className="h-6 w-1/3 rounded-full bg-dash-line-soft" />
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className="h-4 rounded-full bg-dash-subtle" style={{ width: `${90 - i * 12}%` }} />
        ))}
      </div>
    </div>
  );
}
