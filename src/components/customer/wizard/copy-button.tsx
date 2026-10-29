"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/components/ui/primitives";

/**
 * Round copy button next to the IBAN. Shows a green tick briefly after
 * copying. If the browser does not allow writing to the clipboard it says so clearly; it never pretends to have copied.
 */
export function CopyButton({ value, label, copiedText }: { value: string; label: string; copiedText: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
      timer.current = window.setTimeout(() => setState("idle"), 1800);
    } catch {
      setState("failed");
    }
  };

  return (
    <span className="flex flex-none flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={label}
        title={state === "copied" ? "Kopyalandı" : "Kopyala"}
        className={cn(
          "flex size-[42px] items-center justify-center rounded-full text-white transition-colors motion-reduce:transition-none",
          state === "copied" ? "bg-dash-green" : "bg-dash-navy hover:bg-dash-navy-hover",
        )}
      >
        {state === "copied" ? <Check aria-hidden className="size-[17px]" strokeWidth={3.5} /> : <Copy aria-hidden className="size-[18px]" strokeWidth={2.5} />}
      </button>
      <span aria-live="polite" className={state === "failed" ? "text-xs font-semibold text-dash-red" : "sr-only"}>
        {state === "copied" ? copiedText : state === "failed" ? "Kopyalanamadı; lütfen elle seçip kopyalayınız." : ""}
      </span>
    </span>
  );
}
