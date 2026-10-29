"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ComponentProps, type ReactNode } from "react";
import type { ActionResult } from "@/server/result";
import { Dialog, DIALOG_BUTTON, DialogClose, type DialogTone } from "./dialog";
import { Button, cn } from "./primitives";
import { useDismissSuccess } from "./use-dismiss-success";

type Feedback = { tone: "success" | "error"; text: string } | null;

/** Inline message that also announces the result of a server action to screen readers. */
export function ActionFeedback({ feedback, className }: { feedback: Feedback; className?: string }) {
  if (!feedback) return null;
  return (
    <p
      role={feedback.tone === "error" ? "alert" : "status"}
      className={cn("text-sm font-medium", feedback.tone === "error" ? "text-accent-700" : "text-emerald-800", className)}
    >
      {feedback.text}
    </p>
  );
}

/**
 * Shared logic for running a server action and handling its result.
 * Errors are always shown to the user; on success the page data is refreshed.
 */
export function useServerAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);
  useDismissSuccess(feedback, setFeedback);

  const run = (action: () => Promise<ActionResult<unknown>>, onSuccess?: () => void) => {
    setFeedback(null);
    startTransition(async () => {
      let result: ActionResult<unknown>;
      try {
        result = await action();
      } catch (error) {
        // redirect() is propagated as an exception; rethrown so Next.js can handle it.
        if (typeof error === "object" && error !== null && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_")) {
          throw error;
        }
        result = { ok: false, message: "Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyiniz." };
      }
      if (result.ok) {
        setFeedback(result.message ? { tone: "success", text: result.message } : null);
        onSuccess?.();
        router.refresh();
      } else {
        const details = result.fieldErrors ? Object.values(result.fieldErrors) : [];
        setFeedback({ tone: "error", text: details.length > 0 ? `${result.message} ${details.join(" ")}` : result.message });
      }
    });
  };

  return { pending, feedback, run, setFeedback };
}

type ActionButtonProps = Omit<ComponentProps<typeof Button>, "onClick" | "type"> & {
  action: () => Promise<ActionResult<unknown>>;
  pendingLabel?: string;
  /**
   * If given, a confirmation dialog is shown before the action. `tone`: "delete" for deletion (red tint trash can),
   * "danger" for a risky action (filled red exclamation), "neutral" for information. If omitted: risky for a "danger" button, information otherwise.
   */
  confirm?: { title: string; description: ReactNode; confirmLabel: string; tone?: Exclude<DialogTone, "help"> };
  feedbackClassName?: string;
  /** If given, the button is drawn with these classes (variant/size are ignored); for a button in another visual language. */
  buttonClassName?: string;
};

export function ActionButton({ action, pendingLabel = "İşleniyor…", confirm, children, disabled, feedbackClassName, buttonClassName, ...props }: ActionButtonProps) {
  const { pending, feedback, run } = useServerAction();
  const [open, setOpen] = useState(false);
  const confirmTone = confirm?.tone ?? (props.variant === "danger" ? "danger" : "neutral");

  const button = (onClick?: () => void) =>
    buttonClassName ? (
      <button type="button" className={buttonClassName} disabled={disabled || pending} onClick={onClick}>
        {pending ? pendingLabel : children}
      </button>
    ) : (
      <Button {...props} disabled={disabled || pending} onClick={onClick}>
        {pending ? pendingLabel : children}
      </Button>
    );

  return (
    <div className="inline-flex flex-col items-start gap-1.5">
      {confirm ? (
        <Dialog
          open={open}
          onOpenChange={setOpen}
          trigger={button()}
          title={confirm.title}
          description={confirm.description}
          tone={confirmTone}
          footer={
            <>
              <DialogClose className={DIALOG_BUTTON.secondary}>Vazgeç</DialogClose>
              <button
                type="button"
                className={confirmTone === "neutral" ? DIALOG_BUTTON.primary : DIALOG_BUTTON.danger}
                onClick={() => {
                  setOpen(false);
                  run(action);
                }}
              >
                {confirm.confirmLabel}
              </button>
            </>
          }
        />
      ) : (
        button(() => run(action))
      )}
      <ActionFeedback feedback={feedback} className={feedbackClassName} />
    </div>
  );
}
