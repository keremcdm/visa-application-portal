import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicEnv } from "./env";
import { serverSessionCheck, sessionGate, type ServerSessionCheck } from "./session-check";
import { isRemembered, REMEMBER_COOKIE, sessionCookieOptions } from "./session-cookies";

/**
 * Refreshes the session cookies on every request and runs an OPTIMISTIC pre-check for protected pages.
 *
 * This check is only a redirect convenience; it is NOT A SECURITY BOUNDARY. The real authorization happens
 * on every page, server action and route handler (src/server/auth.ts) and in the database (RLS).
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const env = getSupabasePublicEnv();
  if (!env) return response;

  // If "Beni hatırla" was not selected, refreshed session cookies are also written so they are deleted when the browser closes.
  const remember = isRemembered(request.cookies.get(REMEMBER_COOKIE)?.value);

  const supabase = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, sessionCookieOptions(options, remember));
        // Responses carrying session cookies must not be cached by intermediaries.
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // getClaims() verifies the token and refreshes it if needed. Do not run other code in between.
  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims?.sub);

  const { pathname } = request.nextUrl;
  const redirectTo = (path: string, next?: string) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = "";
    if (next) url.searchParams.set("next", next);
    const redirect = NextResponse.redirect(url);
    // Refreshed session cookies are carried over to the redirect response as well.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  };

  // A server action call (e.g. the "Çıkış yap" (sign out) form) is not redirected: the browser expects the action response,
  // not page HTML; if redirected, the "An unexpected response was received from the server" error appears. The action itself checks permission with src/server/auth.ts and redirects if needed.
  if (request.method === "POST" && request.headers.has("next-action")) return response;

  const gate = sessionGate(pathname, isAuthenticated);
  if (gate === "login") return redirectTo("/sign-in", pathname);

  // A signed-in user does not see the sign-in/sign-up pages; they are redirected from there to the right panel for their role.
  // Even if the token looks valid locally the session may have been terminated on the server (e.g. signed out in another
  // browser); pages send that user back to /sign-in. To avoid a loop it is verified on the server first.
  if (gate === "verify") {
    let check: ServerSessionCheck = "unavailable";
    try {
      const { data: verified, error } = await supabase.auth.getUser();
      check = serverSessionCheck(verified.user?.id, error);
      // Cookies of a session refused by the server are deleted from this browser (deletion cookies are written via setAll).
      if (check === "rejected") await supabase.auth.signOut({ scope: "local" });
    } catch (error) {
      // No verdict could be reached: cookies are left alone and the sign-in page opens.
      console.error(JSON.stringify({ level: "error", operation: "proxy.verify_session", name: error instanceof Error ? error.name : "unknown" }));
    }
    if (check === "confirmed") return redirectTo("/panel");
  }

  return response;
}
