import { RISK_QUESTIONS, type RiskBandKey } from "./definition";
import { evaluateRiskTest, isQuestionHidden } from "./scoring";

/**
 * Summary of the customer's Risk Assessment Test result in the admin panel.
 * The result is not stored; it is recomputed from the saved answers every time it is shown (same calculation as on the customer side).
 */
export type RiskTestStaffSummary = {
  bandKey: RiskBandKey;
  badge: string;
  /** "Points to watch" (the same texts as on the customer's result screen). */
  flags: string[];
  /** Visible questions and the given answers, in question order (a conditional question not asked of the customer is excluded). */
  answers: { question: string; answer: string }[];
};

/** `answers` must be a complete array that went through normalizeRiskAnswers. */
export function riskTestStaffSummary(answers: readonly number[]): RiskTestStaffSummary {
  const result = evaluateRiskTest(answers);
  return {
    bandKey: result.band.key,
    badge: result.band.badge,
    flags: result.flags,
    answers: RISK_QUESTIONS.flatMap((question, index) =>
      isQuestionHidden(index, answers) ? [] : [{ question: question.text, answer: question.options[answers[index]!]!.text }],
    ),
  };
}
