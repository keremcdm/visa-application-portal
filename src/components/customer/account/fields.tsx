"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Eye, EyeOff } from "lucide-react";
import { wizButtonClass } from "@/components/customer/wizard/ui";
import { Input } from "@/components/ui/form";

/** Password field: show/hide button with an eye icon on the right. */
export function PasswordInput(props: Omit<ComponentProps<"input">, "type" | "className">) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={shown ? "text" : "password"} className="pr-12" />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? "Şifreyi gizle" : "Şifreyi göster"}
        aria-pressed={shown}
        className="absolute right-2 top-1/2 flex size-[34px] -translate-y-1/2 items-center justify-center rounded-full text-dash-ink-3 hover:bg-dash-subtle hover:text-dash-navy"
      >
        {shown ? <EyeOff aria-hidden className="size-[17px]" strokeWidth={2.5} /> : <Eye aria-hidden className="size-[17px]" strokeWidth={2.5} />}
      </button>
    </div>
  );
}

/** The design's navy pill button, which disables itself while its form is submitting. */
export function WizSubmitButton({ children, pendingLabel }: { children: ReactNode; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-disabled={pending} className={wizButtonClass("primary", "lg")}>
      {pending ? pendingLabel : children}
    </button>
  );
}
