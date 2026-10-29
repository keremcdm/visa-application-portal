import { describe, expect, it } from "vitest";
import { FORM_SECTIONS } from "@/features/application-form/definition";
import { normalizeSectionData, validateSection } from "@/features/application-form/engine";
import type { Field, ScalarField, SectionId } from "@/features/application-form/types";
import { Q, RISK_QUESTIONS } from "@/features/risk-test/definition";
import {
  applyPrefill,
  applyPrefillToForm,
  buildRiskPrefill,
  describePrefill,
  pendingPrefill,
  pendingPrefillForForm,
  type PrefillValue,
} from "@/features/risk-test/prefill";
import { normalizeRiskAnswers } from "@/features/risk-test/scoring";
import { TEST_TODAY } from "../fixtures/sample-form";

const BEST = [2, 1, 1, 2, 1, 2, 3, 2, 3, 2, 3, 2, 0, 2, 1, 3];
const withAnswers = (overrides: Record<number, number>) => BEST.map((v, i) => overrides[i] ?? v);
const pick = (values: PrefillValue[]) => Object.fromEntries(values.map((v) => [`${v.sectionId}.${v.path}`, v.value]));

function scalarAt(sectionId: SectionId, path: string): ScalarField | null {
  let fields: readonly Field[] = FORM_SECTIONS.find((s) => s.id === sectionId)!.fields;
  let found: Field | undefined;
  for (const key of path.split(".")) {
    found = fields.find((f) => f.key === key);
    if (!found) return null;
    if (found.type === "group") fields = found.fields;
  }
  return found && found.type !== "group" && found.type !== "repeat" ? found : null;
}

/** Instead of trying every combination of answers, tries each option of each question one at a time. */
function everySingleAnswerProfile(): number[][] {
  const profiles: number[][] = [];
  RISK_QUESTIONS.forEach((question, index) => {
    question.options.forEach((_, option) => {
      const normalized = normalizeRiskAnswers(withAnswers({ [index]: option }));
      if (normalized) profiles.push(normalized);
    });
  });
  return profiles;
}

describe("risk test → form suggestions", () => {
  it("every suggestion targets an existing form field with a value valid for that field", () => {
    for (const answers of everySingleAnswerProfile()) {
      for (const value of buildRiskPrefill(answers)) {
        const field = scalarAt(value.sectionId, value.path);
        expect(field, `${value.sectionId}.${value.path}`).not.toBeNull();
        if (field!.type === "select") expect(field!.options.map((o) => o.value)).toContain(value.value);
        if (field!.type === "yesno") expect(["yes", "no"]).toContain(value.value);
      }
    }
  });

  it("applying the suggestions causes no validation error in the related fields", () => {
    for (const answers of everySingleAnswerProfile()) {
      const values = buildRiskPrefill(answers);
      for (const section of FORM_SECTIONS) {
        const data = applyPrefill(normalizeSectionData(section, {}), values.filter((v) => v.sectionId === section.id));
        const errors = validateSection(section, data, { [section.id]: data }, TEST_TODAY);
        for (const value of values.filter((v) => v.sectionId === section.id)) {
          expect(errors[value.path], `${section.id}.${value.path}`).toBeUndefined();
        }
      }
    }
  });

  it("maps the marital status, savings, visa and relative answers", () => {
    expect(pick(buildRiskPrefill(BEST))).toEqual({
      "personal.maritalStatus": "married",
      "family.hasDependents": "yes",
      "employment.hasSavings": "yes",
      "history.visitedElsewhere": "yes",
      "family.hasUkRelative": "yes",
      "family.ukRelative.status": "İngiliz vatandaşı",
    });
    expect(pick(buildRiskPrefill(withAnswers({ [Q.maritalStatus]: 0 })))["personal.maritalStatus"]).toBe("single");
    expect(pick(buildRiskPrefill(withAnswers({ [Q.maritalStatus]: 1 })))["family.hasDependents"]).toBeUndefined();
    expect(pick(buildRiskPrefill(withAnswers({ [Q.savings]: 0 })))["employment.hasSavings"]).toBe("no");
    expect(pick(buildRiskPrefill(withAnswers({ [Q.ukVisa]: 0 })))["history.hadUkVisaLast10Years"]).toBe("no");
    // "UK vizesi aldım" (I got a UK visa) does not say whether it was within the last 10 years.
    expect(pick(buildRiskPrefill(BEST))["history.hadUkVisaLast10Years"]).toBeUndefined();
  });

  it("refusal answer: if refused only 'Evet' (yes) is suggested (the number of refusals goes in the explanation); if never refused nothing is suggested", () => {
    for (const answer of [1, 2]) {
      const suggested = pick(buildRiskPrefill(withAnswers({ [Q.ukRefusal]: answer })));
      expect(Object.entries(suggested).filter(([k]) => k.startsWith("security."))).toEqual([["security.ukRefusal", "yes"]]);
    }
    expect(Object.keys(pick(buildRiskPrefill(BEST))).filter((k) => k.startsWith("security"))).toEqual([]);
  });

  it("travel history: if never travelled the counts become 'Hiç' (never); no suggestion for contradicting answers", () => {
    const never = pick(buildRiskPrefill(withAnswers({ [Q.ruleCompliance]: 0, [Q.otherTravel]: 0 })));
    expect(never).toMatchObject({ "history.ukVisitCount": "none", "history.otherCountriesVisitCount": "none", "history.visitedElsewhere": "no" });
    // "Hiç yurt dışı seyahatim olmadı" (never travelled abroad) + "başka ülkelere seyahat ettim" (travelled to other countries)
    const conflicting = pick(buildRiskPrefill(withAnswers({ [Q.ruleCompliance]: 0, [Q.otherTravel]: 2 })));
    expect(Object.keys(conflicting).filter((k) => k.startsWith("history.") && k !== "history.hadUkVisaLast10Years")).toEqual([]);
  });

  it("relative fields are not suggested if there are no relatives", () => {
    const answers = normalizeRiskAnswers(withAnswers({ [Q.ukRelative]: 0 }))!;
    expect(Object.keys(pick(buildRiskPrefill(answers))).filter((k) => k.includes("UkRelative") || k.includes("ukRelative"))).toEqual([]);
  });
});

describe("applying the suggestions to the whole form at once", () => {
  const values = buildRiskPrefill(withAnswers({ [Q.ukRefusal]: 1 }));
  const emptyForm = Object.fromEntries(FORM_SECTIONS.map((s) => [s.id, normalizeSectionData(s, {})]));

  it("shown to the customer in a single list, section by section", () => {
    const groups = pendingPrefillForForm(emptyForm, values);
    expect(groups.map((g) => [g.title, g.items.map((i) => i.path)])).toEqual([
      ["Kişisel bilgiler", ["maritalStatus"]],
      ["Çalışma ve gelir", ["hasSavings"]],
      ["Aile", ["hasDependents", "hasUkRelative", "ukRelative.status"]],
      ["Seyahat geçmişi", ["visitedElsewhere"]],
      ["Ret geçmişi", ["ukRefusal"]],
    ]);
  });

  it("all sections are filled together; only changed sections are returned", () => {
    const { sections, filled } = applyPrefillToForm(emptyForm, values);
    expect(filled).toBe(7);
    expect(Object.keys(sections).sort()).toEqual(["employment", "family", "history", "personal", "security"]);
    expect(sections.personal!.maritalStatus).toBe("married");
    expect(sections.security).toMatchObject({ ukRefusal: "yes" });
    expect((sections.family!.ukRelative as Record<string, unknown>).status).toBe("İngiliz vatandaşı");
    // Apart from the filled values, the section's other fields are not touched.
    expect(sections.personal!.firstName).toBe("");
  });

  it("filled fields are not overwritten and applying again changes nothing", () => {
    const partly = { ...emptyForm, personal: { ...emptyForm.personal, maritalStatus: "divorced" }, security: { ...emptyForm.security, ukRefusal: "no" } };
    const first = applyPrefillToForm(partly, values);
    expect(first.sections.personal).toBeUndefined();
    // Since the customer said "ret almadım" (never refused), the number of refusals is not suggested either (the field stays hidden).
    expect(first.sections.security).toBeUndefined();
    expect(first.filled).toBe(5);

    const after = { ...partly, ...first.sections };
    expect(applyPrefillToForm(after, values)).toEqual({ sections: {}, filled: 0 });
    expect(pendingPrefillForForm(after, values)).toEqual([]);
  });
});

describe("applying suggestions to the form", () => {
  const values = buildRiskPrefill(BEST);
  const family = FORM_SECTIONS.find((s) => s.id === "family")!;
  const empty = normalizeSectionData(family, {});

  it("only empty fields of the section are suggested", () => {
    expect(pendingPrefill("family", empty, values, {}).map((v) => v.path)).toEqual(["hasDependents", "hasUkRelative", "ukRelative.status"]);
    expect(pendingPrefill("passport", normalizeSectionData(FORM_SECTIONS.find((s) => s.id === "passport")!, {}), values, {})).toEqual([]);
  });

  it("a field the customer filled in is not overwritten", () => {
    const answered = { ...empty, hasDependents: "no" };
    expect(pendingPrefill("family", answered, values, {}).map((v) => v.path)).toEqual(["hasUkRelative", "ukRelative.status"]);
    const applied = applyPrefill(answered, values.filter((v) => v.sectionId === "family"));
    expect(applied.hasDependents).toBe("no");
    expect(applied.hasUkRelative).toBe("yes");
    expect((applied.ukRelative as Record<string, unknown>).status).toBe("İngiliz vatandaşı");
  });

  it("if the customer said 'no relatives', the hidden status field is not suggested", () => {
    const answered = { ...empty, hasDependents: "yes", hasUkRelative: "no" };
    expect(pendingPrefill("family", answered, values, {})).toEqual([]);
  });

  it("suggestions are shown to the customer with the field label and a readable value", () => {
    expect(describePrefill(pendingPrefill("family", empty, values, {}))).toEqual([
      { path: "hasDependents", value: "yes", label: "Bakmakla yükümlü olduğunuz kişiler (çocuklarınız) var mı?", display: "Evet" },
      { path: "hasUkRelative", value: "yes", label: "Birleşik Krallık'ta yaşayan akrabanız var mı?", display: "Evet" },
      { path: "ukRelative.status", value: "İngiliz vatandaşı", label: "Birleşik Krallık'taki akrabanız → Statüsü", display: "İngiliz vatandaşı" },
    ]);
    const personal = describePrefill(buildRiskPrefill(BEST).filter((v) => v.sectionId === "personal"));
    expect(personal).toEqual([{ path: "maritalStatus", value: "married", label: "Medeni durumunuz", display: "Evli" }]);
  });
});
