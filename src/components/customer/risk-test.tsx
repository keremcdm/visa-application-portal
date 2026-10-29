"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { RISK_NOTICES, RISK_QUESTIONS, RISK_TEST_TEXT, type RiskBandKey } from "@/features/risk-test/definition";
import {
  answerQuestion,
  evaluateRiskTest,
  isQuestionHidden,
  nextVisibleQuestion,
  normalizeRiskAnswers,
  previousVisibleQuestion,
} from "@/features/risk-test/scoring";
import { saveRiskAssessmentAction } from "@/server/actions/risk-test";

/**
 * RISK ASSESSMENT TEST
 *
 * Layout taken from the original risk test HTML file (styles:
 * `ukvt-*` in globals.css). Questions, scoring and texts are under src/features/risk-test.
 *
 * Deliberate differences from the source file:
 *  - No contact form: the user is signed in and the answers are saved to their own account.
 *  - Instead of a "Danışmanlık Talep Et" (request consultancy) button that went nowhere, there is a link back to the applications.
 */

/** Colors of the result ranges are the values from the source file (five meaningful steps). */
const BAND_COLORS: Record<RiskBandKey, string> = {
  best: "#2e7d4f",
  good: "#3f9d63",
  medium: "#d98a00",
  needs_work: "#d15a1f",
  not_advised: "#b23b3b",
};

const RING_RADIUS = 66;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

type Answers = Array<number | null>;
type SaveState = { status: "idle" | "saving" | "saved" } | { status: "error"; message: string };

const EMPTY_ANSWERS: Answers = RISK_QUESTIONS.map(() => null);

export function RiskTest({
  initialAnswers,
  contact,
  homeHref,
}: {
  /** Previously saved, validated answers; null if none. */
  initialAnswers: number[] | null;
  /** Contact details the company entered in Settings; hidden if not entered. */
  contact: { email: string | null; phone: string | null };
  homeHref: string;
}) {
  const [answers, setAnswers] = useState<Answers>(initialAnswers ?? EMPTY_ANSWERS);
  const [step, setStep] = useState(0);
  const [completed, setCompleted] = useState<number[] | null>(initialAnswers);
  const [save, setSave] = useState<SaveState>({ status: initialAnswers ? "saved" : "idle" });
  const [, startTransition] = useTransition();

  const persist = (finalAnswers: number[]) => {
    setSave({ status: "saving" });
    startTransition(async () => {
      try {
        const result = await saveRiskAssessmentAction(finalAnswers);
        setSave(result.ok ? { status: "saved" } : { status: "error", message: result.message });
      } catch {
        setSave({ status: "error", message: "Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyiniz." });
      }
    });
  };

  const visible = RISK_QUESTIONS.map((_, index) => index).filter((index) => !isQuestionHidden(index, answers));
  const position = Math.max(visible.indexOf(step), 0);
  const isLast = nextVisibleQuestion(step, answers) >= RISK_QUESTIONS.length;

  const goNext = () => {
    if (answers[step] === null) return;
    if (!isLast) {
      setStep(nextVisibleQuestion(step, answers));
      return;
    }
    const finalAnswers = normalizeRiskAnswers(answers);
    if (!finalAnswers) return;
    setCompleted(finalAnswers);
    persist(finalAnswers);
  };

  const restart = () => {
    setAnswers(EMPTY_ANSWERS);
    setStep(0);
    setCompleted(null);
    setSave({ status: "idle" });
  };

  const progress = completed ? 100 : (position / visible.length) * 100;
  const question = RISK_QUESTIONS[step]!;
  const result = completed ? evaluateRiskTest(completed) : null;
  const bandColor = result ? BAND_COLORS[result.band.key] : undefined;

  return (
    <div className="ukvt-app">
      <div className="ukvt-card">
        <div className="ukvt-head">
          <h1>{RISK_TEST_TEXT.title}</h1>
          <p>{RISK_TEST_TEXT.intro}</p>
          <div className="ukvt-bar" role="progressbar" aria-label="Testin ilerlemesi" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
            <i style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="ukvt-body">
          {result === null ? (
            // `key` replays the entry animation when the question changes.
            <div className="ukvt-step" key={step}>
              <fieldset className="ukvt-opts">
                <legend>
                  <span className="ukvt-qno">
                    Soru {position + 1} / {visible.length}
                  </span>
                  <span className="ukvt-q">{question.text}</span>
                </legend>
                {question.options.map((option, index) => {
                  const selected = answers[step] === index;
                  return (
                    <label key={index} className={selected ? "ukvt-opt sel" : "ukvt-opt"}>
                      <input
                        type="radio"
                        name={`risk-question-${step}`}
                        className="sr-only"
                        checked={selected}
                        onChange={() => setAnswers(answerQuestion(answers, step, index))}
                      />
                      <span className="ukvt-radio" aria-hidden />
                      <span>{option.text}</span>
                    </label>
                  );
                })}
              </fieldset>
              <div className="ukvt-nav">
                {step === 0 ? (
                  <span />
                ) : (
                  <button type="button" className="ukvt-btn ukvt-back" onClick={() => setStep(previousVisibleQuestion(step, answers))}>
                    Geri
                  </button>
                )}
                <button type="button" className="ukvt-btn ukvt-next" disabled={answers[step] === null} onClick={goNext}>
                  {isLast ? "Sonucu Gör" : "Devam"}
                </button>
              </div>
            </div>
          ) : (
            <div className="ukvt-result">
              <div className="ukvt-score-ring">
                <svg width="150" height="150" aria-hidden>
                  <circle cx="75" cy="75" r={RING_RADIUS} fill="none" stroke="var(--color-brand-100)" strokeWidth="12" />
                  <circle
                    cx="75"
                    cy="75"
                    r={RING_RADIUS}
                    fill="none"
                    stroke={bandColor}
                    strokeWidth="12"
                    strokeLinecap="round"
                    strokeDasharray={RING_LENGTH}
                    strokeDashoffset={RING_LENGTH * (1 - result.ratio)}
                  />
                </svg>
                <div className="ukvt-score-num">
                  <b className="ukvt-dot" style={{ background: bandColor }} aria-hidden />
                  <span>uygunluk düzeyi</span>
                </div>
              </div>
              <div className="ukvt-badge" style={{ background: bandColor }}>
                {result.band.badge}
              </div>
              <h2 className="ukvt-rtitle">{result.band.title}</h2>
              <p className="ukvt-rtext">{result.band.text}</p>

              <div className="ukvt-closer">
                <p>{result.closer}</p>
              </div>

              <div className="ukvt-flags">
                <h2>{result.flags.length > 0 ? RISK_TEST_TEXT.flagsHeading : RISK_TEST_TEXT.noFlagsHeading}</h2>
                {result.flags.length > 0 ? (
                  result.flags.map((flag) => (
                    <div className="ukvt-flag" key={flag}>
                      <span className="dot" style={{ background: BAND_COLORS.medium }} aria-hidden>
                        !
                      </span>
                      <span>{flag}</span>
                    </div>
                  ))
                ) : (
                  <div className="ukvt-flag">
                    <span className="dot" style={{ background: BAND_COLORS.best }} aria-hidden>
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                    <span>{RISK_TEST_TEXT.noFlags}</span>
                  </div>
                )}
              </div>

              {result.notices.map((key) => (
                <div key={key} className={key === "uk_visa_boost" ? "ukvt-plan positive" : "ukvt-plan"}>
                  <h2>{RISK_NOTICES[key].title}</h2>
                  <p>{RISK_NOTICES[key].text}</p>
                </div>
              ))}

              <div className="ukvt-next-step">
                <h2>Sonraki adım</h2>
                <p>Bu test zorunlu değildir. Hazır olduğunuzda başvurularınıza dönüp başvurunuza başlayabilir veya devam edebilirsiniz.</p>
                {contact.email || contact.phone ? (
                  <p>
                    Sorularınız için: {[contact.email, contact.phone].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
                <Link href={homeHref} className="ukvt-btn ukvt-next">
                  Başvurularıma dön
                </Link>
              </div>

              <div className="ukvt-save">
                {save.status === "saving" ? <p role="status">Cevaplarınız kaydediliyor…</p> : null}
                {save.status === "saved" ? <p role="status">Cevaplarınız hesabınıza kaydedildi.</p> : null}
                {save.status === "error" ? (
                  <div role="alert" className="ukvt-save-error">
                    <p>{save.message}</p>
                    <button type="button" className="ukvt-btn ukvt-back" onClick={() => persist(completed!)}>
                      Tekrar dene
                    </button>
                  </div>
                ) : null}
              </div>

              <button type="button" className="ukvt-restart" onClick={restart}>
                Testi yeniden başlat
              </button>
              <p className="ukvt-disc">{RISK_TEST_TEXT.disclaimer}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
