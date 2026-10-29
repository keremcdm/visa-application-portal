import Link from "next/link";
import type { ReactNode } from "react";
import { Check, TriangleAlert } from "lucide-react";
import { applicationStatusTone } from "@/components/status-badges";
import { cn } from "@/components/ui/primitives";
import { APPLICATION_STATUS_LABELS } from "@/lib/domain/constants";
import { customerApplicationPath, ROUTES } from "@/lib/site";
import type { StepState, WizardStepId } from "@/server/data/customer";
import type { Application } from "@/server/data/types";
import { WizChip, type ChipTone } from "./ui";

/**
 * Page frame of the application steps: warm grey background, Figtree, 1180px width.
 * The top bar is in src/app/panel/layout.tsx.
 */
export function WizardShell({ children }: { children: ReactNode }) {
  return (
    <div className="wiz-root dash-root flex flex-1 flex-col bg-dash-canvas pb-[72px] font-dash text-dash-ink">
      <main id="content" className="mx-auto flex w-full max-w-[1180px] flex-1 flex-col gap-7 px-4 pt-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}

const STEPS: { id: WizardStepId; label: string; path: string }[] = [
  { id: "type", label: "Başvuru tipi", path: "type" },
  { id: "form", label: "Başvuru formu", path: "form/personal" },
  { id: "documents", label: "Evraklar", path: "documents" },
  { id: "appointment", label: "Randevu tercihi", path: "appointment" },
  { id: "fee", label: "Ücret", path: "fee" },
  { id: "summary", label: "Özet ve gönder", path: "summary" },
];

const STATE_TEXT: Record<StepState, string> = { complete: "tamamlandı", incomplete: "eksik var", todo: "yapılmadı" };

/** Step number circle: current step solid navy, completed green tick, incomplete yellow warning, others grey outline. */
function StepMark({ state, active, number }: { state: StepState; active: boolean; number: number }) {
  const base = "flex size-[22px] flex-none items-center justify-center rounded-full text-xs font-bold";
  if (active) return <span aria-hidden className={cn(base, "bg-dash-navy text-white")}>{number}</span>;
  if (state === "complete")
    return (
      <span aria-hidden className={cn(base, "bg-dash-green text-white")}>
        <Check className="size-[11px]" strokeWidth={3.5} />
      </span>
    );
  if (state === "incomplete")
    return (
      <span aria-hidden className={cn(base, "bg-dash-draft-bg text-dash-draft-ink")}>
        <TriangleAlert className="size-3" strokeWidth={2.75} />
      </span>
    );
  return (
    <span aria-hidden className={cn(base, "border-[1.5px] border-dash-check text-dash-ink-3")}>
      {number}
    </span>
  );
}

const tabClass = (active: boolean) =>
  cn(
    "-mb-px flex items-center gap-2.5 whitespace-nowrap border-b-2 pb-4 text-sm",
    active ? "border-dash-navy font-bold text-dash-navy" : "border-transparent font-semibold text-dash-ink-3 hover:text-dash-navy",
  );

/**
 * Top of the application pages: breadcrumb, title and status label; the step bar for drafts, tabs after submission.
 */
export function WizardHeader({
  application,
  current,
  steps,
  aside,
  statusTone,
}: {
  application: Application;
  current: WizardStepId | "status";
  steps: Record<WizardStepId, StepState>;
  /** Element shown to the right of the title (the autosave indicator on the application form). */
  aside?: ReactNode;
  /** The tone of the status label changes with the given value (e.g. red for a visa refusal). */
  statusTone?: ChipTone;
}) {
  const isDraft = application.status === "draft";
  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-2.5">
        <p className="text-[13px] text-dash-ink-3">
          <Link href={ROUTES.customer} className="font-semibold text-dash-ink-2 hover:text-dash-navy">
            Başvurularım
          </Link>
          <span> / {application.referenceCode}</span>
        </p>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-2xl font-extrabold leading-tight tracking-[-0.02em] sm:text-[28px]">Başvuru {application.referenceCode}</p>
            <WizChip tone={statusTone ?? applicationStatusTone(application.status)}>{APPLICATION_STATUS_LABELS[application.status]}</WizChip>
          </div>
          {aside}
        </div>
      </div>

      {isDraft ? (
        <nav aria-label="Başvuru adımları" className="relative overflow-x-auto overflow-y-hidden [scrollbar-width:thin]">
          <ol className="flex w-max min-w-full gap-8 border-b border-dash-field">
            {STEPS.map((step, index) => {
              const active = step.id === current;
              return (
                <li key={step.id} className="flex">
                  <Link href={customerApplicationPath(application.id, step.path)} aria-current={active ? "step" : undefined} className={tabClass(active)}>
                    <StepMark state={steps[step.id]} active={active} number={index + 1} />
                    <span>
                      <span className="sr-only">{index + 1}. </span>
                      {step.label}
                      <span className="sr-only"> ({STATE_TEXT[steps[step.id]]})</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>
      ) : (
        <nav aria-label="Başvuru bölümleri" className="relative overflow-x-auto overflow-y-hidden [scrollbar-width:thin]">
          <div className="flex w-max min-w-full gap-8 border-b border-dash-field">
            {[
              { id: "status", label: "Durum", path: undefined as string | undefined },
              { id: "documents", label: "Evraklar", path: "documents" },
              { id: "appointment", label: "Randevu", path: "appointment" },
              { id: "summary", label: "Form cevaplarım", path: "summary" },
            ].map((tab) => {
              const active = tab.id === current;
              return (
                <Link
                  key={tab.id}
                  href={customerApplicationPath(application.id, tab.path)}
                  aria-current={active ? "page" : undefined}
                  className={tabClass(active)}
                >
                  {tab.label}
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
