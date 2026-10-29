"use client";

import { useSyncExternalStore } from "react";

/*
 * WHEN THE INTERNET CONNECTION DROPS
 * Problem fixed: while offline "Kaydet" did nothing and "Kaydet ve devam et" kicked the user out of the site (the next
 * page could not load, so the browser's "no internet" page opened).
 * Now nothing is sent to the server and the page is not left while offline; a clear message is shown and the data the user
 * entered stays on the page.
 */

export const OFFLINE_MESSAGE = "İnternet bağlantınız yok. Girdiğiniz bilgiler bu sayfada duruyor; bağlantınız gelince tekrar deneyiniz.";
export const UNREACHABLE_MESSAGE = "Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyiniz.";

/** true if the browser knows the connection is down (treated as online when unknown). */
export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * Calls a server action. Does not call it at all while offline; if the request fails with a network error, the error is
 * returned in the action's own error format instead of bubbling up to the page's error screen.
 */
export async function callAction<T>(run: () => Promise<T>): Promise<T | { ok: false; message: string }> {
  if (isOffline()) return { ok: false, message: OFFLINE_MESSAGE };
  try {
    return await run();
  } catch {
    return { ok: false, message: isOffline() ? OFFLINE_MESSAGE : UNREACHABLE_MESSAGE };
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** Connection state; treated as online on the server and on first render. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
