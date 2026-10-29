"use client";

import { useEffect, type Dispatch, type SetStateAction } from "react";

type Feedback = { tone: "success" | "error"; text: string } | null;

/** How long a success message stays on screen: long enough to read, at least 6 and at most 20 seconds. */
export function successVisibleMs(text: string): number {
  return Math.min(20_000, Math.max(6_000, text.length * 70));
}

/**
 * A success message disappears by itself after a while; it does not wait for the next action or a page refresh. Error messages stay until the user does something new.
 */
export function useDismissSuccess<T extends Feedback>(feedback: T, setFeedback: Dispatch<SetStateAction<T>>): void {
  useEffect(() => {
    if (feedback?.tone !== "success") return;
    const timer = window.setTimeout(() => setFeedback((current) => (current === feedback ? (null as T) : current)), successVisibleMs(feedback.text));
    return () => window.clearTimeout(timer);
  }, [feedback, setFeedback]);
}
