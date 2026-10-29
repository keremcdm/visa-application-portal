import type { ComponentProps, ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// --- Buttons -------------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

// "ui-button": in the admin panel (.admin-root) the font weight is adapted to the design (globals.css).
const BUTTON_BASE =
  "ui-button inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand-800 text-white hover:bg-brand-700",
  secondary: "border border-line bg-white text-ink hover:bg-brand-50",
  ghost: "text-brand-700 hover:bg-brand-50",
  danger: "border border-accent-600 bg-white text-accent-700 hover:bg-accent-50",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3 text-sm",
  md: "min-h-11 px-4 text-[0.9375rem]",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string): string {
  return cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className);
}

type ButtonProps = ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize };

export function Button({ variant = "primary", size = "md", className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

// --- Surfaces ------------------------------------------------------------------

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-lg border border-line bg-surface", className)} {...props} />;
}

export function CardSection({
  title,
  description,
  actions,
  children,
  className,
  headingLevel = "h2",
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  headingLevel?: "h2" | "h3";
}) {
  const Heading = headingLevel;
  return (
    <Card className={className}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <Heading className="ui-card-title text-base font-semibold text-ink">{title}</Heading>
          {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children ? <div className="px-5 py-4">{children}</div> : null}
    </Card>
  );
}

// --- Notice boxes --------------------------------------------------------------

type Tone = "info" | "success" | "warning" | "danger" | "neutral";

const ALERT_TONES: Record<Exclude<Tone, "neutral">, { box: string; icon: typeof Info }> = {
  info: { box: "border-brand-200 bg-brand-50 text-brand-900", icon: Info },
  success: { box: "border-emerald-200 bg-emerald-50 text-emerald-900", icon: CheckCircle2 },
  warning: { box: "border-amber-300 bg-amber-50 text-amber-900", icon: TriangleAlert },
  danger: { box: "border-accent-600/40 bg-accent-50 text-accent-700", icon: AlertCircle },
};

export function Alert({
  tone = "info",
  title,
  children,
  className,
  role,
}: {
  tone?: Exclude<Tone, "neutral">;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Pass "alert" for error messages and "status" for status information. */
  role?: "alert" | "status";
}) {
  const { box, icon: Icon } = ALERT_TONES[tone];
  return (
    <div role={role} className={cn("flex gap-3 rounded-md border px-4 py-3 text-sm leading-6", box, className)}>
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={title ? "mt-0.5" : undefined}>{children}</div> : null}
      </div>
    </div>
  );
}

const BADGE_TONES: Record<Tone, string> = {
  neutral: "border-slate-300 bg-slate-100 text-slate-700",
  info: "border-brand-200 bg-brand-50 text-brand-800",
  success: "border-emerald-300 bg-emerald-50 text-emerald-800",
  warning: "border-amber-300 bg-amber-50 text-amber-900",
  danger: "border-accent-600/40 bg-accent-50 text-accent-700",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("ui-badge inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium leading-5", `ui-badge-${tone}`, BADGE_TONES[tone], className)}>
      {children}
    </span>
  );
}

/** Plain placeholder shown while page content streams in from the server. */
export function LoadingBlock({ label = "Yükleniyor…", lines = 4 }: { label?: string; lines?: number }) {
  return (
    <div role="status" aria-live="polite" className="rounded-lg border border-line bg-surface p-5">
      <span className="sr-only">{label}</span>
      <div aria-hidden className="space-y-3">
        <div className="h-5 w-1/3 rounded bg-slate-200" />
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className="h-4 rounded bg-slate-100" style={{ width: `${90 - i * 12}%` }} />
        ))}
      </div>
    </div>
  );
}
