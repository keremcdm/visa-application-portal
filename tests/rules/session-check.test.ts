import { describe, expect, it } from "vitest";
import { AUTH_PAGES, serverSessionCheck, sessionGate } from "@/lib/supabase/session-check";

describe("the proxy's redirect rule", () => {
  it("a user without a session is redirected to the sign-in page on a protected page", () => {
    for (const path of ["/panel", "/panel/notifications", "/admin", "/admin/settings"]) expect(sessionGate(path, false)).toBe("login");
  });

  it("paths that only look like a protected prefix are not treated as protected", () => {
    for (const path of ["/panelx", "/adminx", "/", "/sign-in", "/privacy-notice"]) expect(sessionGate(path, false)).toBe("pass");
  });

  it("a user whose token looks valid is not redirected from the sign-in pages to the panel without verification", () => {
    for (const path of AUTH_PAGES) expect(sessionGate(path, true)).toBe("verify");
  });

  it("other requests of a user whose token looks valid pass without extra verification on the server", () => {
    for (const path of ["/panel", "/admin/settings", "/reset-password", "/cookie-policy"]) expect(sessionGate(path, true)).toBe("pass");
  });

  it("a signed-in user is also verified on the server from the entry screen ('/') and redirected to the panel", () => {
    expect(AUTH_PAGES).toContain("/");
    expect(sessionGate("/", true)).toBe("verify");
  });
});

describe("verifying the session on the server", () => {
  it("the session is verified if a user is returned", () => {
    expect(serverSessionCheck("user-1", null)).toBe("confirmed");
  });

  it("a session terminated on the server is rejected (the case that caused the loop)", () => {
    expect(serverSessionCheck(null, { name: "AuthSessionMissingError", status: 400 })).toBe("rejected");
  });

  it("a definite rejection by the server (deleted or blocked user, invalid token) is treated as rejected", () => {
    for (const status of [401, 403, 404]) expect(serverSessionCheck(null, { name: "AuthApiError", status })).toBe("rejected");
  });

  it("no verdict on a temporary error; otherwise a network outage would sign the user out", () => {
    expect(serverSessionCheck(null, { name: "AuthRetryableFetchError", status: 0 })).toBe("unavailable");
    expect(serverSessionCheck(null, { name: "AuthRetryableFetchError", status: 503 })).toBe("unavailable");
    expect(serverSessionCheck(null, { name: "AuthApiError", status: 429 })).toBe("unavailable");
    expect(serverSessionCheck(null, { name: "AuthUnknownError" })).toBe("unavailable");
  });

  it("with neither an error nor a user, the session is not verified and the cookie is not deleted", () => {
    expect(serverSessionCheck(null, null)).toBe("unavailable");
    expect(serverSessionCheck(undefined, undefined)).toBe("unavailable");
  });

  it("the session is not verified when there is an error, even if a user id comes back", () => {
    expect(serverSessionCheck("user-1", { name: "AuthApiError", status: 403 })).toBe("rejected");
  });
});
