import { describe, expect, it } from "vitest";
import {
  combinationError,
  compareRules,
  normalizeApplicationTypes,
  requiredDocuments,
  ruleApplies,
  ruleTitle,
  sameCombination,
  type DocumentRule,
} from "@/features/documents/document-rules";
import { bySortOrder, changedSortOrders, isCompleteOrder, moveItem, nextSortOrder } from "@/features/staff/ordering";

/** Document rules by application type combination (migration 20) and the order of Settings lists; synthetic data. */

const rules: DocumentRule[] = [
  { id: "r0", applicationTypes: [], sponsorStatus: null, items: [{ documentTypeId: "passport", requirement: "required" }, { documentTypeId: "photo", requirement: "optional" }] },
  { id: "r1", applicationTypes: ["student"], sponsorStatus: null, items: [{ documentTypeId: "student_cert", requirement: "required" }] },
  {
    id: "r2",
    applicationTypes: ["student", "sponsored"],
    sponsorStatus: null,
    items: [
      { documentTypeId: "sponsor_letter", requirement: "required" },
      { documentTypeId: "photo", requirement: "required" },
    ],
  },
  { id: "r3", applicationTypes: ["sponsored"], sponsorStatus: "retired", items: [{ documentTypeId: "pension", requirement: "optional" }] },
];

const catalog = ["passport", "photo", "student_cert", "sponsor_letter", "pension", "consent"].map((id) => ({ id, isActive: true, minorsOnly: id === "consent" }));

describe("document rules", () => {
  it("a rule applies if all its types are selected; an empty rule applies to every application", () => {
    expect(ruleApplies(rules[0]!, { applicationTypes: [], sponsorStatus: null })).toBe(true);
    expect(ruleApplies(rules[2]!, { applicationTypes: ["student"], sponsorStatus: null })).toBe(false);
    expect(ruleApplies(rules[2]!, { applicationTypes: ["sponsored", "student", "retired"], sponsorStatus: "employee" })).toBe(true);
    expect(ruleApplies(rules[3]!, { applicationTypes: ["sponsored"], sponsorStatus: "employee" })).toBe(false);
    expect(ruleApplies(rules[3]!, { applicationTypes: ["sponsored"], sponsorStatus: "retired" })).toBe(true);
  });

  it("a customer choosing only student gets the shared and student documents; student + sponsored also gets the combination's documents", () => {
    expect(requiredDocuments(rules, { applicationTypes: ["student"], sponsorStatus: null }, catalog, false)).toEqual([
      { documentTypeId: "passport", requirement: "required" },
      { documentTypeId: "photo", requirement: "optional" },
      { documentTypeId: "student_cert", requirement: "required" },
    ]);
    expect(requiredDocuments(rules, { applicationTypes: ["student", "sponsored"], sponsorStatus: "employee" }, catalog, false)).toEqual([
      { documentTypeId: "passport", requirement: "required" },
      // Optional in the shared rule, required in the combination: the strictest rule wins.
      { documentTypeId: "photo", requirement: "required" },
      { documentTypeId: "student_cert", requirement: "required" },
      { documentTypeId: "sponsor_letter", requirement: "required" },
    ]);
  });

  it("a retired document is not required; a document for under-18s is only listed on request", () => {
    const withConsent: DocumentRule[] = [...rules, { id: "r4", applicationTypes: [], sponsorStatus: null, items: [{ documentTypeId: "consent", requirement: "required" }] }];
    const inactivePhoto = catalog.map((doc) => (doc.id === "photo" ? { ...doc, isActive: false } : doc));
    const ids = (includeMinors: boolean) =>
      requiredDocuments(withConsent, { applicationTypes: [], sponsorStatus: null }, inactivePhoto, includeMinors).map((d) => d.documentTypeId);
    expect(ids(false)).toEqual(["passport"]);
    expect(ids(true)).toEqual(["passport", "consent"]);
  });

  it("rule name, combination comparison and display order", () => {
    expect(ruleTitle(rules[0]!)).toBe("Tüm başvurular (ortak belgeler)");
    expect(ruleTitle({ applicationTypes: ["sponsored", "student"], sponsorStatus: null })).toBe("Öğrenci + Sponsorlu Başvuru");
    expect(ruleTitle(rules[3]!)).toBe("Sponsorlu Başvuru (sponsor: Emekli)");
    expect(normalizeApplicationTypes(["sponsored", "student", "student", "bilinmeyen"])).toEqual(["student", "sponsored"]);
    expect(sameCombination({ applicationTypes: ["sponsored", "student"], sponsorStatus: null }, rules[2]!)).toBe(true);
    expect(sameCombination(rules[2]!, { applicationTypes: ["student", "sponsored"], sponsorStatus: "retired" })).toBe(false);
    expect([...rules].reverse().sort(compareRules).map((r) => r.id)).toEqual(["r0", "r1", "r3", "r2"]);
  });

  it("the same combination cannot be defined twice; sponsor status only in a sponsored rule", () => {
    expect(combinationError({ id: null, applicationTypes: ["sponsored", "student"], sponsorStatus: null }, rules)).toMatch(/zaten bir kural var/);
    expect(combinationError({ id: "r2", applicationTypes: ["student", "sponsored"], sponsorStatus: null }, rules)).toBeNull();
    expect(combinationError({ id: null, applicationTypes: ["student"], sponsorStatus: "retired" }, rules)).toMatch(/yalnızca “Sponsorlu Başvuru”/);
    expect(combinationError({ id: null, applicationTypes: ["student", "retired"], sponsorStatus: null }, rules)).toBeNull();
  });
});

describe("order of Settings lists", () => {
  it("an item is moved; the list does not change for an invalid position", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
  });

  it("a list without an order is sorted by its old rule, an ordered list by sort_order", () => {
    const byName = bySortOrder<{ name: string; sortOrder: number }>((a, b) => a.name.localeCompare(b.name, "tr"));
    const unordered = [{ name: "İzmir", sortOrder: 0 }, { name: "Bursa", sortOrder: 0 }];
    expect([...unordered].sort(byName).map((c) => c.name)).toEqual(["Bursa", "İzmir"]);
    const ordered = [{ name: "Bursa", sortOrder: 2 }, { name: "İzmir", sortOrder: 1 }];
    expect([...ordered].sort(byName).map((c) => c.name)).toEqual(["İzmir", "Bursa"]);
  });

  it("only rows whose order changed are written; an order with missing or extra ids is rejected; a new row goes to the end", () => {
    const current = new Map([["a", 1], ["b", 2], ["c", 3]]);
    expect(changedSortOrders(["a", "c", "b"], current)).toEqual([{ id: "c", sortOrder: 2 }, { id: "b", sortOrder: 3 }]);
    expect(isCompleteOrder(["a", "c", "b"], current.keys())).toBe(true);
    expect(isCompleteOrder(["a", "b"], current.keys())).toBe(false);
    expect(isCompleteOrder(["a", "b", "b"], current.keys())).toBe(false);
    expect(isCompleteOrder(["a", "b", "x"], current.keys())).toBe(false);
    expect(nextSortOrder([0, 0])).toBe(0);
    expect(nextSortOrder([3, 1, 2])).toBe(4);
  });
});
