import { describe, expect, it } from "vitest";
import { isRemembered, parseCookieHeader, serializeCookie, sessionCookieOptions } from "@/lib/supabase/session-cookies";

/** Options Supabase passes when writing its session cookies. */
const SUPABASE_SET = { path: "/", sameSite: "lax" as const, httpOnly: false, maxAge: 400 * 24 * 60 * 60 };
const SUPABASE_REMOVE = { path: "/", sameSite: "lax" as const, httpOnly: false, maxAge: 0 };

describe("'Beni hatırla' (remember me) – lifetime of the session cookies", () => {
  it("the session is persistent only if the preference cookie is '1'", () => {
    expect(isRemembered("1")).toBe(true);
    for (const value of [undefined, null, "", "0", "true", "on"]) expect(isRemembered(value)).toBe(false);
  });

  it("in a session that is not remembered the cookie is written without a lifetime; other options are kept", () => {
    const options = sessionCookieOptions({ ...SUPABASE_SET, expires: new Date("2030-01-01T00:00:00Z") }, false);
    expect(options).toEqual({ path: "/", sameSite: "lax", httpOnly: false });
    expect("maxAge" in options).toBe(false);
    expect("expires" in options).toBe(false);
  });

  it("options do not change in a remembered session", () => {
    expect(sessionCookieOptions(SUPABASE_SET, true)).toBe(SUPABASE_SET);
  });

  it("a deletion cookie is left alone; otherwise the cookie would stay in the browser after sign-out", () => {
    expect(sessionCookieOptions(SUPABASE_REMOVE, false)).toBe(SUPABASE_REMOVE);
    expect(sessionCookieOptions(SUPABASE_REMOVE, true)).toBe(SUPABASE_REMOVE);
  });

  it("does not mutate the given options object", () => {
    const original = { ...SUPABASE_SET };
    sessionCookieOptions(original, false);
    expect(original).toEqual(SUPABASE_SET);
  });
});

describe("reading and writing cookies in the browser", () => {
  it("turns the document.cookie string into a name-value list", () => {
    expect(parseCookieHeader("")).toEqual([]);
    expect(parseCookieHeader("vbp-remember=1; sb-test-auth-token.0=base64-abc_DEF-123; bos=")).toEqual([
      { name: "vbp-remember", value: "1" },
      { name: "sb-test-auth-token.0", value: "base64-abc_DEF-123" },
      { name: "bos", value: "" },
    ]);
  });

  it("decodes an encoded value, keeps an '=' in the value, leaves a malformed encoding as is", () => {
    expect(parseCookieHeader("a=x%20y; b=k=v; c=%E0%A4%A")).toEqual([
      { name: "a", value: "x y" },
      { name: "b", value: "k=v" },
      { name: "c", value: "%E0%A4%A" },
    ]);
  });

  it("if a name repeats, the first value wins", () => {
    expect(parseCookieHeader("a=1; a=2")).toEqual([{ name: "a", value: "1" }]);
  });

  it("written with a lifetime in a remembered session, without one otherwise", () => {
    expect(serializeCookie("sb-test-auth-token", "base64-abc", sessionCookieOptions(SUPABASE_SET, true))).toBe(
      "sb-test-auth-token=base64-abc; Max-Age=34560000; Path=/; SameSite=Lax",
    );
    expect(serializeCookie("sb-test-auth-token", "base64-abc", sessionCookieOptions(SUPABASE_SET, false))).toBe(
      "sb-test-auth-token=base64-abc; Path=/; SameSite=Lax",
    );
  });

  it("a deletion cookie is written with Max-Age=0 and HttpOnly is never added", () => {
    expect(serializeCookie("sb-test-auth-token", "", sessionCookieOptions(SUPABASE_REMOVE, false))).toBe("sb-test-auth-token=; Max-Age=0; Path=/; SameSite=Lax");
    const withHttpOnly = serializeCookie("a", "b", { ...SUPABASE_SET, httpOnly: true } as Parameters<typeof serializeCookie>[2]);
    expect(withHttpOnly).not.toContain("HttpOnly");
  });

  it("encodes the value and writes the other attributes", () => {
    expect(serializeCookie("a", "x y;z", { domain: "example.com", secure: true, sameSite: "strict", expires: new Date("2030-01-01T00:00:00Z") })).toBe(
      "a=x%20y%3Bz; Domain=example.com; Expires=Tue, 01 Jan 2030 00:00:00 GMT; Secure; SameSite=Strict",
    );
    expect(serializeCookie("a", "b", { sameSite: "none" })).toBe("a=b; SameSite=None");
  });

  it("a written cookie gives the same value when read back", () => {
    const value = 'base64-eyJhIjoiYiJ9 "tırnak" ü';
    const written = serializeCookie("ad", value, { path: "/" }).split(";")[0]!;
    expect(parseCookieHeader(written)).toEqual([{ name: "ad", value }]);
  });
});
