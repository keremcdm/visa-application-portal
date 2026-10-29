import "server-only";
import type { NextRequest } from "next/server";
import { ERROR_PAGES, SESSION_EXPIRED_LOGIN_PATH, type ErrorPageKind } from "@/lib/site";

/**
 * Same-origin check for state-changing requests in route handlers.
 * Server Actions already do this check inside Next.js; route handlers do not.
 * Session cookies are SameSite=Lax so they are not sent on cross-site POSTs; this check is an extra layer.
 */
export function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    // Browsers send Origin on POST requests; otherwise Sec-Fetch-Site decides.
    return request.headers.get("sec-fetch-site") === "same-origin";
  }
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function jsonError(status: number, message: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ ok: false, message, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
}

/** true if the address was opened directly in the browser (clicking a link, the address bar); false for fetch requests. */
export function isBrowserNavigation(request: Request): boolean {
  const mode = request.headers.get("sec-fetch-mode");
  if (mode) return mode === "navigate";
  // For older browsers that do not send Sec-Fetch-Mode.
  return (request.headers.get("accept") ?? "").includes("text/html");
}

/**
 * Error response for routes opened through links (file view, form PDF).
 * On browser navigation the user is redirected to an error page instead of raw JSON, or to the sign-in page if the session
 * has expired; programmatic requests get JSON with the status code. The access decision is made in the calling route;
 * this function only picks the shape of the response.
 */
export function navigationError(request: Request, status: number, message: string, page: ErrorPageKind): Response {
  if (!isBrowserNavigation(request)) return jsonError(status, message);
  const location = status === 401 ? SESSION_EXPIRED_LOGIN_PATH : ERROR_PAGES[page].path;
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
}
