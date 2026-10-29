import { describe, expect, it } from "vitest";
import {
  formatRecoveryCode,
  generateRecoveryCode,
  hashRecoveryCode,
  isRecoveryCodeFormat,
  normalizeRecoveryCode,
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_LENGTH,
} from "@/features/auth/recovery-code";

/** Two-factor authentication recovery code. */
describe("yedek kod", () => {
  it("20 characters, groups of 4, no easily confused characters", () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$/);
    expect(RECOVERY_CODE_LENGTH).toBe(20);
    for (const confusing of ["0", "O", "1", "I", "L"]) expect(RECOVERY_CODE_ALPHABET).not.toContain(confusing);
    expect(isRecoveryCodeFormat(normalizeRecoveryCode(code))).toBe(true);
  });

  it("different every time, mixing letters and digits", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateRecoveryCode()));
    expect(codes.size).toBe(200);
    const joined = [...codes].join("");
    expect(joined).toMatch(/[A-Z]/);
    expect(joined).toMatch(/[2-9]/);
  });

  it("a typed code gives the same digest regardless of spaces, dashes and lower case", () => {
    const code = formatRecoveryCode("K7Q49MZDX2PHRT6W8BNC");
    expect(code).toBe("K7Q4-9MZD-X2PH-RT6W-8BNC");
    const typed = normalizeRecoveryCode(" k7q4 9mzd-x2ph rt6w-8bnc ");
    expect(typed).toBe("K7Q49MZDX2PHRT6W8BNC");
    expect(hashRecoveryCode(typed)).toBe(hashRecoveryCode(normalizeRecoveryCode(code)));
    expect(hashRecoveryCode(typed)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a wrong length or a disallowed character is a format error", () => {
    expect(isRecoveryCodeFormat(normalizeRecoveryCode("K7Q4-9MZD"))).toBe(false);
    expect(isRecoveryCodeFormat(normalizeRecoveryCode("K7Q4-9MZD-X2PH-RT6W-8BN0"))).toBe(false);
    expect(normalizeRecoveryCode(123)).toBe("");
  });
});
