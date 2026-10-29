import { describe, expect, it } from "vitest";
import {
  changedKeys,
  errorsOfRow,
  isNewRowKey,
  newRowKey,
  parseBatchInput,
  pruneDrafts,
  rowFieldErrorKey,
  sameValues,
  savedDespiteFailure,
  withoutDrafts,
  withoutRowErrors,
} from "@/features/unsaved-changes/drafts";
import { guardedDestination, type LinkClick } from "@/features/unsaved-changes/navigation";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const isUuid = (id: string) => /^[0-9a-f-]{36}$/.test(id);
const NEW_ROW = newRowKey(1);

describe("unsaved changes – drafts", () => {
  const server: Record<string, { name: string; sortOrder: number; isActive: boolean }> = {
    [UUID_A]: { name: "Ankara", sortOrder: 10, isActive: true },
    [UUID_B]: { name: "İstanbul", sortOrder: 20, isActive: true },
  };
  const base = (key: string) => server[key];

  it("values are compared field by field", () => {
    expect(sameValues({ a: 1, b: "x" }, { b: "x", a: 1 })).toBe(true);
    expect(sameValues({ a: 1 }, { a: 1, b: null })).toBe(false);
    expect(sameValues({ a: 0 }, { a: "0" })).toBe(false);
  });

  it("only drafts that differ from their counterpart count as changes", () => {
    const drafts = {
      [UUID_A]: { name: "Ankara", sortOrder: 10, isActive: true }, // undone change
      [UUID_B]: { name: "İstanbul", sortOrder: 20, isActive: false },
      "silinmis-satir": { name: "Bursa", sortOrder: 40, isActive: true },
    };
    expect(changedKeys(drafts, base)).toEqual([UUID_B]);
  });

  it("ids of new rows opened with 'Ekle' have a separate format and never mix with existing records", () => {
    expect(newRowKey(1)).toBe("new-1");
    expect(isNewRowKey("new-12")).toBe(true);
    for (const key of [UUID_A, "new", "new-", "new-x", "new-1.name", "passport_copy"]) expect(isNewRowKey(key), key).toBe(false);
  });

  it("when new data arrives from the server, drafts without changes are dropped and the others are kept", () => {
    const drafts = {
      [UUID_A]: { name: "Ankara", sortOrder: 10, isActive: true },
      [UUID_B]: { name: "İstanbul", sortOrder: 25, isActive: true },
    };
    expect(pruneDrafts(drafts, base)).toEqual({ [UUID_B]: drafts[UUID_B] });
    // If nothing is dropped the same object is returned (no needless re-render).
    const kept = { [UUID_B]: drafts[UUID_B] };
    expect(pruneDrafts(kept, base)).toBe(kept);
    expect(withoutDrafts(drafts, [UUID_A])).toEqual({ [UUID_B]: drafts[UUID_B] });
  });
});

describe("unsaved changes – batch save result", () => {
  it("row errors are split into row and field", () => {
    const errors = { [rowFieldErrorKey(UUID_A, "name")]: "Şehir adını yazınız.", [UUID_B]: "Bu adla bir şehir zaten var.", [rowFieldErrorKey(NEW_ROW, "surchargeAmount")]: "Geçersiz." };
    expect(errorsOfRow(errors, UUID_A)).toEqual({ fields: { name: "Şehir adını yazınız." }, row: null });
    expect(errorsOfRow(errors, UUID_B)).toEqual({ fields: {}, row: "Bu adla bir şehir zaten var." });
    expect(errorsOfRow(errors, NEW_ROW)).toEqual({ fields: { surchargeAmount: "Geçersiz." }, row: null });
    expect(errorsOfRow(undefined, UUID_A)).toEqual({ fields: {}, row: null });
  });

  it("errors of a row being fixed are dropped; those of other rows remain", () => {
    const errors = { [rowFieldErrorKey(UUID_A, "name")]: "Şehir adını yazınız.", [UUID_A]: "Kaydedilemedi.", [UUID_B]: "Bu adla bir şehir zaten var." };
    expect(withoutRowErrors(errors, UUID_A)).toEqual({ [UUID_B]: "Bu adla bir şehir zaten var." });
    expect(withoutRowErrors(errors, NEW_ROW)).toBe(errors);
  });

  it("on a validation error no row counts as saved", () => {
    expect(savedDespiteFailure([UUID_A, UUID_B], { [rowFieldErrorKey(UUID_A, "name")]: "Şehir adını yazınız." })).toEqual([]);
  });

  it("on a write error only rows without an error count as saved", () => {
    expect(savedDespiteFailure([UUID_A, UUID_B, NEW_ROW], { [UUID_B]: "Bu adla bir şehir zaten var." })).toEqual([UUID_A, NEW_ROW]);
  });

  it("an error not tied to a row (session, connection) means nothing was saved", () => {
    expect(savedDespiteFailure([UUID_A], undefined)).toEqual([]);
    expect(savedDespiteFailure([UUID_A], {})).toEqual([]);
  });
});

describe("unsaved changes – shape of the batch save request", () => {
  it("parses a valid request; leaves the values as they are", () => {
    expect(
      parseBatchInput({ updates: [{ id: UUID_A, values: { name: "x" } }], creates: [{ key: "new-1", values: { name: "y" } }, { key: "new-2", values: { name: "z" } }] }, isUuid, 10),
    ).toEqual({
      updates: [{ id: UUID_A, values: { name: "x" } }],
      creates: [
        { key: "new-1", values: { name: "y" } },
        { key: "new-2", values: { name: "z" } },
      ],
    });
    expect(parseBatchInput({ updates: [] }, isUuid, 10)).toEqual({ updates: [], creates: [] });
  });

  it("rejects a broken shape, invalid or duplicate ids, and a request exceeding the limit", () => {
    for (const input of [
      null,
      "metin",
      [],
      { updates: "x" },
      { updates: [null] },
      { updates: [[UUID_A]] },
      { updates: [{ id: 5, values: {} }] },
      { updates: [{ id: "../baska", values: {} }] },
      { updates: [{ id: NEW_ROW, values: {} }] },
      { updates: [], creates: "x" },
      { updates: [], creates: [{ key: UUID_A, values: {} }] },
      { updates: [], creates: [{ key: "new-1", values: {} }, { key: "new-1", values: {} }] },
      { updates: [{ id: UUID_A, values: {} }, { id: UUID_A, values: {} }] },
    ]) {
      expect(parseBatchInput(input, isUuid, 10), JSON.stringify(input)).toBeNull();
    }
    const many = { updates: Array.from({ length: 3 }, (_, i) => ({ id: `${UUID_A.slice(0, -1)}${i}`, values: {} })) };
    expect(parseBatchInput(many, isUuid, 2)).toBeNull();
    // The limit applies to existing and new rows combined.
    expect(parseBatchInput({ updates: [{ id: UUID_A, values: {} }], creates: [{ key: "new-1", values: {} }, { key: "new-2", values: {} }] }, isUuid, 2)).toBeNull();
    // A dot is not accepted in any id because it would break the row error format.
    expect(parseBatchInput({ updates: [{ id: "a.b", values: {} }] }, () => true, 10)).toBeNull();
  });
});

describe("unsaved changes – warning when leaving the page", () => {
  const current = new URL("http://localhost:3000/admin/settings?section=cities");
  const click = (overrides: Partial<LinkClick>): LinkClick => ({
    href: "/admin",
    target: null,
    download: false,
    button: 0,
    modifier: false,
    defaultPrevented: false,
    ...overrides,
  });

  it("a link to another page of the site or another tab is stopped", () => {
    expect(guardedDestination(click({}), current)).toBe("/admin");
    expect(guardedDestination(click({ href: "/admin/settings?section=documents" }), current)).toBe("/admin/settings?section=documents");
    expect(guardedDestination(click({ href: "/admin/settings" }), current)).toBe("/admin/settings");
    expect(guardedDestination(click({ href: "http://localhost:3000/admin#list", target: "_self" }), current)).toBe("/admin#list");
  });

  it("clicks that do not lose changes are not stopped", () => {
    // Same page (only the # changes)
    expect(guardedDestination(click({ href: "#content" }), current)).toBeNull();
    expect(guardedDestination(click({ href: "/admin/settings?section=cities" }), current)).toBeNull();
    // New tab, download, middle button, modifier key
    expect(guardedDestination(click({ target: "_blank" }), current)).toBeNull();
    expect(guardedDestination(click({ download: true }), current)).toBeNull();
    expect(guardedDestination(click({ button: 1 }), current)).toBeNull();
    expect(guardedDestination(click({ modifier: true }), current)).toBeNull();
    // A click another handler already stopped
    expect(guardedDestination(click({ defaultPrevented: true }), current)).toBeNull();
    // No link address or a non-site scheme
    expect(guardedDestination(click({ href: null }), current)).toBeNull();
    expect(guardedDestination(click({ href: "mailto:ornek@example.com" }), current)).toBeNull();
    expect(guardedDestination(click({ href: "tel:+900000000000" }), current)).toBeNull();
  });

  it("a link to another site is left to the browser's own warning", () => {
    expect(guardedDestination(click({ href: "https://example.com/" }), current)).toBeNull();
    expect(guardedDestination(click({ href: "//example.com/yol" }), current)).toBeNull();
  });
});
