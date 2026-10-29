"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { markFeeStepSeenAction } from "@/server/actions/applications";

/**
 * In a draft, opening the Fee step turns the step's mark green. It is only recorded when the page is actually opened in the browser
 * (not during prefetching). If it cannot be saved the mark stays empty; the customer's application is not affected.
 */
export function FeeStepSeen({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    markFeeStepSeenAction(applicationId)
      .then((result) => {
        if (result.ok) router.refresh();
      })
      .catch(() => {
        // If offline, the mark turns green the next time the page opens.
      });
  }, [applicationId, router]);
  return null;
}
