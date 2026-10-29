import type { ComponentProps, ReactNode } from "react";
import { cn } from "./primitives";

/**
 * Accessible form field wrapper: binds the label, hint and error message
 * to the control via aria-describedby.
 */
export function Field({
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
  /** Extra element shown next to the label (e.g. a help button). */
  labelExtra?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
          {required ? (
            <span className="ml-1 text-accent-700" aria-hidden>
              *
            </span>
          ) : null}
        </label>
        {labelExtra}
      </div>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-sm font-medium text-accent-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Builds the aria attributes for the control. */
export function describedBy(id: string, hint: unknown, error: unknown): string | undefined {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn("field-control", className)} {...props} />;
}

export function Textarea({ className, rows = 3, ...props }: ComponentProps<"textarea">) {
  return <textarea rows={rows} className={cn("field-control resize-y", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={cn("field-control pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Checkbox({
  id,
  label,
  error,
  className,
  ...props
}: Omit<ComponentProps<"input">, "type"> & { id: string; label: ReactNode; error?: string | null }) {
  return (
    <div className={className}>
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          className="mt-1 size-4 shrink-0 rounded border-line accent-brand-800"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          {...props}
        />
        <label htmlFor={id} className="text-sm leading-6 text-ink">
          {label}
        </label>
      </div>
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-sm font-medium text-accent-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
