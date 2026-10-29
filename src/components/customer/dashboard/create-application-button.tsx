"use client";

import { ActionFeedback, useServerAction } from "@/components/ui/action-button";
import { createApplicationAction } from "@/server/actions/applications";

/** "Yeni başvuru oluştur" (create new application; red, as in the design). On success goes to the first step of the new application. */
export function CreateApplicationButton() {
  const { pending, feedback, run } = useServerAction();
  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        disabled={pending}
        onClick={() => run(createApplicationAction)}
        className="h-12 rounded-full bg-dash-red px-6 text-[15px] font-bold text-white hover:bg-dash-red-hover disabled:opacity-70"
      >
        {pending ? "Oluşturuluyor…" : "Yeni başvuru oluştur"}
      </button>
      <ActionFeedback feedback={feedback} />
    </div>
  );
}
