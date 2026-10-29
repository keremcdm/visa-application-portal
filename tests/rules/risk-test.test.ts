import { describe, expect, it } from "vitest";
import { Q, RISK_BANDS, RISK_QUESTIONS, RISK_TEST_VERSION } from "@/features/risk-test/definition";
import {
  answerQuestion,
  evaluateRiskTest,
  isQuestionHidden,
  nextVisibleQuestion,
  normalizeRiskAnswers,
  previousVisibleQuestion,
  RISK_BONUS_MAX,
  RISK_MAX_SCORE,
} from "@/features/risk-test/scoring";

/**
 * The expected values were found by applying the calculation in the HTML file by hand.
 * These tests guarantee that the scoring in the portal gives the same result as that file.
 */

// The highest-scoring option for every question.
const BEST = [2, 1, 1, 2, 1, 2, 3, 2, 3, 2, 3, 2, 0, 2, 1, 3];
// A profile without visa history or assets, but also without any negative (negative-scoring) answer.
const NO_NEGATIVE_LOW = [0, 0, 0, 0, 0, 0, 0, 1, 2, 1, 0, 0, 0, 0, 0, 0];
// Has a UK visa; income records, savings and deposits negative; more than one refusal; one overstay.
const HIGH_RISK = [0, 0, 1, 0, 2, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0];

describe("risk assessment test – definition", () => {
  it("contains the 16 questions and two bonus questions from the source file", () => {
    expect(RISK_TEST_VERSION).toBe(1);
    expect(RISK_QUESTIONS).toHaveLength(16);
    expect(RISK_QUESTIONS.filter((q) => q.bonus).map((q) => q.text)).toEqual([
      "Daha önce ABD vizesi aldınız mı?",
      "Daha önce UK (İngiltere) vizesi aldınız mı?",
    ]);
    expect(RISK_MAX_SCORE).toBe(99);
    expect(RISK_BONUS_MAX).toBe(32);
  });

  it("band thresholds are sorted from high to low and the lowest is zero", () => {
    expect(RISK_BANDS.map((b) => b.min)).toEqual([0.8, 0.6, 0.5, 0.4, 0]);
    expect(RISK_BANDS.map((b) => b.badge)).toEqual(["En İyi Uygunluk", "İyi Uygunluk", "Orta Uygunluk", "Üzerinde Çalışılmalı", "Başvuru Önerilmiyor"]);
  });
});

describe("risk assessment test – conditional question", () => {
  it("without relatives the relative's status is not asked and the answer becomes 'none'", () => {
    const answers = answerQuestion([], Q.ukRelative, 0);
    expect(isQuestionHidden(Q.ukRelativeStatus, answers)).toBe(true);
    expect(answers[Q.ukRelativeStatus]).toBe(0);
    expect(nextVisibleQuestion(Q.ukRelative, answers)).toBe(RISK_QUESTIONS.length);
    expect(previousVisibleQuestion(RISK_QUESTIONS.length, answers)).toBe(Q.ukRelative);
  });

  it("if relatives is switched to 'yes' the auto-filled 'none' answer is removed and a real answer is kept", () => {
    const none = answerQuestion([], Q.ukRelative, 0);
    const has = answerQuestion(none, Q.ukRelative, 1);
    expect(isQuestionHidden(Q.ukRelativeStatus, has)).toBe(false);
    expect(has[Q.ukRelativeStatus]).toBeNull();
    expect(nextVisibleQuestion(Q.ukRelative, has)).toBe(Q.ukRelativeStatus);
    const answered = answerQuestion(has, Q.ukRelativeStatus, 2);
    expect(answerQuestion(answered, Q.ukRelative, 1)[Q.ukRelativeStatus]).toBe(2);
  });
});

describe("risk assessment test – untrusted input", () => {
  it("rejects missing, extra, non-numeric or out-of-range answers", () => {
    expect(normalizeRiskAnswers(BEST)).toEqual(BEST);
    expect(normalizeRiskAnswers(BEST.slice(0, 15))).toBeNull();
    expect(normalizeRiskAnswers([...BEST, 0])).toBeNull();
    expect(normalizeRiskAnswers(BEST.map((v, i) => (i === 3 ? null : v)))).toBeNull();
    expect(normalizeRiskAnswers(BEST.map((v, i) => (i === 3 ? "1" : v)))).toBeNull();
    expect(normalizeRiskAnswers(BEST.map((v, i) => (i === 3 ? 1.5 : v)))).toBeNull();
    expect(normalizeRiskAnswers(BEST.map((v, i) => (i === 1 ? 2 : v)))).toBeNull();
    expect(normalizeRiskAnswers(BEST.map((v, i) => (i === 0 ? -1 : v)))).toBeNull();
    expect(normalizeRiskAnswers("değil")).toBeNull();
    expect(normalizeRiskAnswers(null)).toBeNull();
  });

  it("enforces consistency of the relative questions", () => {
    // No relatives but the status "İngiliz vatandaşı" (British citizen) was sent: the status is pulled to "none" (earns no points).
    const forged = BEST.map((v, i) => (i === Q.ukRelative ? 0 : v));
    expect(normalizeRiskAnswers(forged)![Q.ukRelativeStatus]).toBe(0);
    // Has relatives but the status is "Yaşayan akrabam yok" (no living relatives): invalid.
    expect(normalizeRiskAnswers(BEST.map((v, i) => (i === Q.ukRelativeStatus ? 0 : v)))).toBeNull();
  });
});

describe("risk analiz testi – puanlama", () => {
  it("best answers: full ratio, best band, no warnings", () => {
    const result = evaluateRiskTest(BEST);
    expect(result.ratio).toBe(1);
    expect(result.band.key).toBe("best");
    expect(result.flags).toEqual([]);
    expect(result.notices).toEqual([]);
    expect(result.closerKey).toBe("strong");
  });

  it("a weak profile without negative answers does not fall below 'Orta Uygunluk' (medium eligibility)", () => {
    // Raw ratio 26/99 ≈ 0.26; raised to 0.50 since there is no negative answer.
    const result = evaluateRiskTest(NO_NEGATIVE_LOW);
    expect(result.ratio).toBe(0.5);
    expect(result.band.key).toBe("medium");
    expect(result.notices).toEqual([]);
    expect(result.closerKey).toBe("no_visa_history");
    // Questions answered with the lowest-scoring option that have a warning: visa history, employment status, income, assets.
    expect(result.flags).toHaveLength(4);
    expect(result.flags[0]).toMatch(/Daha önce vizeniz olmadığı için/);
  });

  it("high-risk profile: the score is pulled to zero, the UK visa bonus raises the ratio to 0.30", () => {
    // Non-bonus total −56 → 0. Bonus 16/32 = 0.5 → 0 + (1 − 0) × 0.5 × 0.6 = 0.30.
    const result = evaluateRiskTest(HIGH_RISK);
    expect(result.ratio).toBeCloseTo(0.3, 10);
    expect(result.band.key).toBe("not_advised");
    expect(result.notices).toEqual(["plan", "uk_visa_boost", "low_savings"]);
    expect(result.closerKey).toBe("multiple_refusals");
    expect(result.flags).toHaveLength(9);
  });

  it("if both bonus questions are positive, 60% of the remaining distance is closed", () => {
    // NO_NEGATIVE_LOW + US and UK visa: 26/99 + (1 − 26/99) × 1 × 0.6.
    const answers = NO_NEGATIVE_LOW.map((v, i) => (i === Q.usaVisa || i === Q.ukVisa ? 1 : v));
    const expected = 26 / 99 + (1 - 26 / 99) * 0.6;
    const result = evaluateRiskTest(answers);
    expect(result.ratio).toBeCloseTo(expected, 10);
    expect(result.band.key).toBe("good");
  });

  it("the closing paragraph follows the priority order of the source file", () => {
    const withAnswer = (base: number[], index: number, option: number) => base.map((v, i) => (i === index ? option : v));
    expect(evaluateRiskTest(withAnswer(BEST, Q.ukRefusal, 1)).closerKey).toBe("one_refusal");
    // Financial risk + UK visa
    expect(evaluateRiskTest(withAnswer(BEST, Q.unexplainedDeposit, 0)).closerKey).toBe("money_risk_uk_visa");
    // Financial risk + only a Schengen/US visa
    expect(evaluateRiskTest(withAnswer(withAnswer(BEST, Q.unexplainedDeposit, 0), Q.ukVisa, 0)).closerKey).toBe("money_risk_other_visa");
    // Financial risk, no visa history
    const noVisa = withAnswer(withAnswer(withAnswer(BEST, Q.schengenVisa, 0), Q.usaVisa, 0), Q.ukVisa, 0);
    expect(evaluateRiskTest(withAnswer(noVisa, Q.incomeRecords, 0)).closerKey).toBe("money_risk");
    // Only low savings
    expect(evaluateRiskTest(withAnswer(BEST, Q.savings, 1)).closerKey).toBe("low_savings");
    // No risk, ratio below 0.60, has visa history
    expect(evaluateRiskTest(withAnswer(NO_NEGATIVE_LOW, Q.schengenVisa, 1)).closerKey).toBe("below_good");
  });

  it("the low savings warning only appears for the first two savings options", () => {
    const withSavings = (option: number) => evaluateRiskTest(BEST.map((v, i) => (i === Q.savings ? option : v))).notices;
    expect(withSavings(0)).toContain("low_savings");
    expect(withSavings(1)).toContain("low_savings");
    expect(withSavings(2)).not.toContain("low_savings");
    expect(withSavings(3)).not.toContain("low_savings");
  });
});
