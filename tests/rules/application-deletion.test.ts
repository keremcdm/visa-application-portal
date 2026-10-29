import { describe, expect, it } from "vitest";
import { canDeleteApplication, deletionNeedsReference, referenceConfirmed } from "@/features/staff/application-deletion";

/** An admin deleting an application. The server and the database check permission. */
describe("confirming application deletion", () => {
  it("a draft is deleted with a single confirmation; for a submitted application the number must be typed", () => {
    expect(deletionNeedsReference("draft")).toBe(false);
    for (const status of ["submitted", "in_review", "cancelled", "result_communicated"] as const) expect(deletionNeedsReference(status)).toBe(true);
    expect(canDeleteApplication("draft", "VB-2026-ABC123", "")).toEqual({ ok: true });
    expect(canDeleteApplication("submitted", "VB-2026-ABC123", "")).toMatchObject({ ok: false });
    expect(canDeleteApplication("submitted", "VB-2026-ABC123", "VB-2026-ABC12")).toMatchObject({ ok: false });
    expect(canDeleteApplication("submitted", "VB-2026-ABC123", "VB-2026-ABC123")).toEqual({ ok: true });
  });

  it("spaces and case do not matter; empty text does not count as confirmation", () => {
    expect(referenceConfirmed("VB-2026-ABC123", " vb-2026-abc123 ")).toBe(true);
    expect(referenceConfirmed("", "")).toBe(false);
  });
});
