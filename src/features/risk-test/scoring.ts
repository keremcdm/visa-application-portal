import {
  BONUS_WEIGHT,
  NO_NEGATIVE_FLOOR,
  Q,
  RISK_BANDS,
  RISK_CLOSERS,
  RISK_QUESTIONS,
  type RiskBand,
  type RiskCloserKey,
  type RiskNoticeKey,
} from "./definition";

/**
 * Scoring of the risk assessment test (pure functions).
 * The calculation is the same as `showResult` and `buildCloser` in the HTML file.
 */

/** Index of the selected option per question; null for an unanswered question. */
export type RiskAnswers = ReadonlyArray<number | null>;

/** The relative status question is not asked if "do you have first-degree relatives?" is answered "Hayır, yok" (no). */
export function isQuestionHidden(index: number, answers: RiskAnswers): boolean {
  return index === Q.ukRelativeStatus && answers[Q.ukRelative] === 0;
}

/** Index of the next visible question; the number of questions if none is left. */
export function nextVisibleQuestion(index: number, answers: RiskAnswers): number {
  let next = index + 1;
  while (next < RISK_QUESTIONS.length && isQuestionHidden(next, answers)) next++;
  return next;
}

/** Index of the previous visible question; 0 when on the first question. */
export function previousVisibleQuestion(index: number, answers: RiskAnswers): number {
  let previous = index - 1;
  while (previous > 0 && isQuestionHidden(previous, answers)) previous--;
  return Math.max(previous, 0);
}

/**
 * Records an answer and keeps the conditional question consistent: with no relatives the status question becomes
 * "Yaşayan akrabam yok" (no living relatives); with relatives a previously auto-filled "none" answer is removed.
 */
export function answerQuestion(answers: RiskAnswers, index: number, option: number): Array<number | null> {
  const next = answers.slice(0, RISK_QUESTIONS.length);
  while (next.length < RISK_QUESTIONS.length) next.push(null);
  next[index] = option;
  if (index === Q.ukRelative) {
    if (option === 0) next[Q.ukRelativeStatus] = 0;
    else if (next[Q.ukRelativeStatus] === 0) next[Q.ukRelativeStatus] = null;
  }
  return next;
}

/**
 * Reduces untrusted input (from the client or the database) to a complete answer array.
 * Every visible question must be answered with a valid option index; otherwise returns null.
 */
export function normalizeRiskAnswers(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length !== RISK_QUESTIONS.length) return null;
  const answers: number[] = [];
  for (let i = 0; i < RISK_QUESTIONS.length; i++) {
    const value: unknown = raw[i];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= RISK_QUESTIONS[i]!.options.length) return null;
    answers.push(value);
  }
  // Without relatives the status answer is always "Yaşayan akrabam yok"; with relatives it cannot be "none".
  if (answers[Q.ukRelative] === 0) answers[Q.ukRelativeStatus] = 0;
  else if (answers[Q.ukRelativeStatus] === 0) return null;
  return answers;
}

const pointsOf = (answers: readonly number[], index: number): number => RISK_QUESTIONS[index]!.options[answers[index]!]!.points;

const maxPoints = (bonus: boolean): number =>
  RISK_QUESTIONS.reduce((sum, question) => (Boolean(question.bonus) === bonus ? sum + Math.max(...question.options.map((o) => o.points)) : sum), 0);

/** Maximum total score of the non-bonus questions. */
export const RISK_MAX_SCORE = maxPoints(false);
/** Maximum total score of the bonus questions. */
export const RISK_BONUS_MAX = maxPoints(true);

export type RiskResult = {
  /** Eligibility ratio between 0 and 1. Never shown to the customer as a number; only the band is shown. */
  ratio: number;
  band: RiskBand;
  /** "Points to watch" list; if empty there is no notable risk area. */
  flags: string[];
  closerKey: RiskCloserKey;
  closer: string;
  /** Extra boxes shown on the result screen. */
  notices: RiskNoticeKey[];
};

/** `answers` must be a complete array that went through normalizeRiskAnswers. */
export function evaluateRiskTest(answers: readonly number[]): RiskResult {
  // Main ratio: score of the non-bonus questions / maximum score.
  let score = 0;
  let bonusScore = 0;
  RISK_QUESTIONS.forEach((question, index) => {
    if (question.bonus) bonusScore += pointsOf(answers, index);
    else score += pointsOf(answers, index);
  });
  let ratio = Math.min(Math.max(score, 0) / RISK_MAX_SCORE, 1);

  // A US/UK visa is a pure bonus: if present it closes part of the remaining distance, otherwise it has no effect.
  if (RISK_BONUS_MAX > 0) {
    ratio = Math.min(ratio + (1 - ratio) * (bonusScore / RISK_BONUS_MAX) * BONUS_WEIGHT, 1);
  }

  // A person without any negative answer does not fall into the lowest bands just because they got no bonus.
  const hasNegative = RISK_QUESTIONS.some((_, index) => pointsOf(answers, index) < 0);
  if (!hasNegative && ratio < NO_NEGATIVE_FLOOR) ratio = NO_NEGATIVE_FLOOR;

  const band = RISK_BANDS.find((b) => ratio >= b.min) ?? RISK_BANDS[RISK_BANDS.length - 1]!;

  const flags: string[] = [];
  RISK_QUESTIONS.forEach((question, index) => {
    if (!question.lowFlag) return;
    const points = pointsOf(answers, index);
    const lowest = Math.min(...question.options.map((o) => o.points));
    if (points === lowest || points < 0) flags.push(question.lowFlag);
  });

  const hasUkVisa = answers[Q.ukVisa] === 1;
  const accountIssue = pointsOf(answers, Q.incomeRecords) < 0 || pointsOf(answers, Q.savings) < 0 || pointsOf(answers, Q.unexplainedDeposit) < 0;
  const lowSavings = answers[Q.savings] === 0 || answers[Q.savings] === 1;

  const notices: RiskNoticeKey[] = [];
  if (hasNegative) notices.push("plan");
  if (hasUkVisa && accountIssue) notices.push("uk_visa_boost");
  if (lowSavings) notices.push("low_savings");

  const closerKey = chooseCloser(answers, ratio, lowSavings);
  return { ratio, band, flags, closerKey, closer: RISK_CLOSERS[closerKey], notices };
}

function chooseCloser(answers: readonly number[], ratio: number, lowSavings: boolean): RiskCloserKey {
  const hasSchengen = answers[Q.schengenVisa] !== 0;
  const hasUsa = answers[Q.usaVisa] === 1;
  const hasUk = answers[Q.ukVisa] === 1;
  // Financial risk: income inconsistent with official records or deposits whose source cannot be explained.
  const moneyRisk = pointsOf(answers, Q.incomeRecords) < 0 || pointsOf(answers, Q.unexplainedDeposit) < 0;

  if (answers[Q.ukRefusal] === 2) return "multiple_refusals";
  if (answers[Q.ukRefusal] === 1) return "one_refusal";
  if (moneyRisk && hasUk) return "money_risk_uk_visa";
  if (moneyRisk && (hasUsa || hasSchengen)) return "money_risk_other_visa";
  if (moneyRisk) return "money_risk";
  if (lowSavings) return "low_savings";
  if (ratio < 0.4) return "very_low";
  if (!hasSchengen && !hasUsa && !hasUk) return "no_visa_history";
  if (ratio < 0.6) return "below_good";
  return "strong";
}
