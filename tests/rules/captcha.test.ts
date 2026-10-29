import { describe, expect, it } from "vitest";
import { isCaptchaError, parseCaptchaToken } from "@/features/auth/captcha";

/** CAPTCHA: the token coming from the form is untrusted data. */
describe("CAPTCHA belirteci", () => {
  it("accepts only text of reasonable length without spaces; ignores everything else", () => {
    expect(parseCaptchaToken("0.AbC-def_123.xyz")).toBe("0.AbC-def_123.xyz");
    expect(parseCaptchaToken("")).toBeUndefined();
    expect(parseCaptchaToken("iki kelime")).toBeUndefined();
    expect(parseCaptchaToken("satır\nsonu")).toBeUndefined();
    expect(parseCaptchaToken("x".repeat(4097))).toBeUndefined();
    expect(parseCaptchaToken(null)).toBeUndefined();
    expect(parseCaptchaToken(["dizi"])).toBeUndefined();
  });

  it("Supabase's verification error is recognized separately (so it is not covered by a success message)", () => {
    expect(isCaptchaError({ code: "captcha_failed" })).toBe(true);
    expect(isCaptchaError({ code: "invalid_credentials" })).toBe(false);
    expect(isCaptchaError(null)).toBe(false);
  });
});
