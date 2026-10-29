import {
  APPLICATION_TYPE_LABELS,
  APPLICATION_TYPES,
  SPONSOR_STATUS_LABELS,
  SPONSOR_STATUSES,
  type ApplicationType,
  type DocumentRequirement,
  type SponsorStatus,
} from "@/lib/domain/constants";

/**
 * DOCUMENT RULES BY APPLICATION TYPE COMBINATION
 *
 * A rule applies if ALL application types IN THE RULE are selected in the application; a rule with an empty type list applies
 * to every application (shared documents). If a sponsor status is given the rule only applies to that sponsor status. If the
 * same document comes from several rules the strictest rule wins: required > optional.
 *
 * The database counterpart is private.application_required_documents; the customer's document list is produced there. The
 * functions here are for the preview and validation in Settings; both follow the same rule (tests/rules/document-rules.test.ts,
 * tests/db/rls.test.ts).
 */

export type DocumentRuleItem = { documentTypeId: string; requirement: DocumentRequirement };

export type DocumentRule = {
  id: string;
  applicationTypes: ApplicationType[];
  sponsorStatus: SponsorStatus | null;
  items: DocumentRuleItem[];
};

/** The application (or the selection in the preview) checked against the rule. */
export type RuleTarget = { applicationTypes: readonly string[]; sponsorStatus: string | null };

const STRENGTH: Record<DocumentRequirement, number> = { optional: 1, required: 2 };

/** De-duplicates the valid types and puts them in a fixed order (so the same combination is not stored twice in different orders). */
export function normalizeApplicationTypes(types: readonly string[]): ApplicationType[] {
  return APPLICATION_TYPES.filter((type) => types.includes(type));
}

export function ruleApplies(rule: Pick<DocumentRule, "applicationTypes" | "sponsorStatus">, target: RuleTarget): boolean {
  if (!rule.applicationTypes.every((type) => target.applicationTypes.includes(type))) return false;
  return rule.sponsorStatus === null || rule.sponsorStatus === target.sponsorStatus;
}

export function strongerRequirement(a: DocumentRequirement, b: DocumentRequirement): DocumentRequirement {
  return STRENGTH[a] >= STRENGTH[b] ? a : b;
}

export type CatalogDocument = { id: string; isActive: boolean; minorsOnly: boolean };

/**
 * Documents and their rules from the rules matching the selection; in document catalogue order. Retired documents are not required.
 * `includeMinorsOnly`: also list documents required only from applicants under 18.
 */
export function requiredDocuments(
  rules: readonly DocumentRule[],
  target: RuleTarget,
  catalog: readonly CatalogDocument[],
  includeMinorsOnly: boolean,
): { documentTypeId: string; requirement: DocumentRequirement }[] {
  const strongest = new Map<string, DocumentRequirement>();
  for (const rule of rules) {
    if (!ruleApplies(rule, target)) continue;
    for (const item of rule.items) {
      const current = strongest.get(item.documentTypeId);
      strongest.set(item.documentTypeId, current ? strongerRequirement(current, item.requirement) : item.requirement);
    }
  }
  return catalog
    .filter((doc) => doc.isActive && (includeMinorsOnly || !doc.minorsOnly) && strongest.has(doc.id))
    .map((doc) => ({ documentTypeId: doc.id, requirement: strongest.get(doc.id)! }));
}

/** Rule name: "Tüm başvurular (ortak belgeler)", "Öğrenci", "Öğrenci + Sponsorlu Başvuru (sponsor: Çalışan)". */
export function ruleTitle(rule: Pick<DocumentRule, "applicationTypes" | "sponsorStatus">): string {
  if (rule.applicationTypes.length === 0) return "Tüm başvurular (ortak belgeler)";
  const types = normalizeApplicationTypes(rule.applicationTypes)
    .map((type) => APPLICATION_TYPE_LABELS[type])
    .join(" + ");
  return rule.sponsorStatus ? `${types} (sponsor: ${SPONSOR_STATUS_LABELS[rule.sponsorStatus]})` : types;
}

export function sameCombination(a: Pick<DocumentRule, "applicationTypes" | "sponsorStatus">, b: Pick<DocumentRule, "applicationTypes" | "sponsorStatus">): boolean {
  const ta = normalizeApplicationTypes(a.applicationTypes);
  const tb = normalizeApplicationTypes(b.applicationTypes);
  return ta.length === tb.length && ta.every((type, i) => type === tb[i]) && (a.sponsorStatus ?? null) === (b.sponsorStatus ?? null);
}

/** Display order: the shared rule, single-type rules, then combinations; for the same types the sponsor status comes after. */
export function compareRules(a: Pick<DocumentRule, "applicationTypes" | "sponsorStatus">, b: Pick<DocumentRule, "applicationTypes" | "sponsorStatus">): number {
  const ta = normalizeApplicationTypes(a.applicationTypes);
  const tb = normalizeApplicationTypes(b.applicationTypes);
  if (ta.length !== tb.length) return ta.length - tb.length;
  for (let i = 0; i < ta.length; i += 1) {
    const diff = APPLICATION_TYPES.indexOf(ta[i]!) - APPLICATION_TYPES.indexOf(tb[i]!);
    if (diff !== 0) return diff;
  }
  const sa = a.sponsorStatus ? SPONSOR_STATUSES.indexOf(a.sponsorStatus) : -1;
  const sb = b.sponsorStatus ? SPONSOR_STATUSES.indexOf(b.sponsorStatus) : -1;
  return sa - sb;
}

/** Checks the combination before a rule is saved; null if there is no problem. */
export function combinationError(
  rule: Pick<DocumentRule, "applicationTypes" | "sponsorStatus"> & { id: string | null },
  others: readonly Pick<DocumentRule, "id" | "applicationTypes" | "sponsorStatus">[],
): string | null {
  if (rule.sponsorStatus && !rule.applicationTypes.includes("sponsored")) {
    return "Sponsor durumu yalnızca “Sponsorlu Başvuru” seçiliyken seçilebilir.";
  }
  const duplicate = others.find((other) => other.id !== rule.id && sameCombination(other, rule));
  if (duplicate) return `“${ruleTitle(duplicate)}” için zaten bir kural var. Belgeleri o kuralı düzenleyerek değiştiriniz.`;
  return null;
}
