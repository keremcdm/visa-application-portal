import { describe, expect, it } from "vitest";
import { ERROR_PAGES, SESSION_EXPIRED_LOGIN_PATH } from "@/lib/site";
import { isBrowserNavigation, navigationError } from "@/server/http";

const URL_WITH_ID = "http://localhost:3000/api/files/ae320e4a-b0d4-46a2-959b-8bfb964b82c3";

function request(headers: Record<string, string>): Request {
  return new Request(URL_WITH_ID, { headers });
}

describe("error response of routes opened through links", () => {
  it("recognizes browser navigation by Sec-Fetch-Mode, otherwise by Accept", () => {
    expect(isBrowserNavigation(request({ "sec-fetch-mode": "navigate" }))).toBe(true);
    expect(isBrowserNavigation(request({ "sec-fetch-mode": "cors", accept: "text/html" }))).toBe(false);
    expect(isBrowserNavigation(request({ "sec-fetch-mode": "no-cors" }))).toBe(false);
    expect(isBrowserNavigation(request({ accept: "text/html,application/xhtml+xml" }))).toBe(true);
    expect(isBrowserNavigation(request({ accept: "application/json" }))).toBe(false);
    expect(isBrowserNavigation(request({}))).toBe(false);
  });

  it("returns JSON keeping the status code for programmatic requests", async () => {
    const response = navigationError(request({ "sec-fetch-mode": "cors" }), 403, "Bu işlem için yetkiniz bulunmuyor.", "forbidden");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, message: "Bu işlem için yetkiniz bulunmuyor." });
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects to the matching error page on browser navigation", () => {
    for (const kind of ["file", "forbidden", "record", "temporary"] as const) {
      const response = navigationError(request({ "sec-fetch-mode": "navigate" }), 404, "Kayıt bulunamadı.", kind);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(ERROR_PAGES[kind].path);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("redirects to the sign-in page instead of an error page if the session has expired", () => {
    const response = navigationError(request({ "sec-fetch-mode": "navigate" }), 401, "Oturumunuz sona ermiş.", "file");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(SESSION_EXPIRED_LOGIN_PATH);
  });

  it("the redirect address does not carry the id of the requested record", () => {
    const response = navigationError(request({ "sec-fetch-mode": "navigate" }), 404, "Kayıt bulunamadı.", "file");
    expect(response.headers.get("location")).not.toContain("ae320e4a");
  });
});
