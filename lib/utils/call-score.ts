import {
  CLASSIFICATION_DESCRIPTIONS,
  CLASSIFICATION_LABELS,
  PHONE_CALL_SCORING_VERSION,
  URGENCY_LABELS,
  type CallClassification,
  type CallerMood,
  type CallUrgency,
} from "@/lib/integrations/phone-call-scoring-prompt";
import type { PhoneCallRow } from "@/types/voice-assistant";

/**
 * One place that decides what a scored call looks like on screen.
 *
 * Two rubrics have written to this table. Rows judged by the retired 0–100
 * rubric were rescaled to 1–10 by migration 0070 and stamped `version: 1`, so
 * their number sits on the same scale as everything else but is a converted
 * rank, not a verdict the current rubric made. Every read goes through here so
 * a converted row is shown uncoloured and says so, rather than each component
 * guessing.
 */
export type CallScoreView = {
  /** Rounded, on the 1–10 scale (or 0–100 for a row 0070 never converted). */
  value: number | null;
  outOf: 10 | 100;
  /**
   * Scored by the retired rubric: it has no kind, and its number is a
   * converted rank. Re-scoring replaces it with a real judgement.
   */
  legacy: boolean;
  classification: CallClassification | null;
  classificationLabel: string | null;
  classificationHelp: string | null;
  /** What happened on the call, in the model's words. */
  summary: string | null;
  /** What the assistant got wrong, when it got something wrong. */
  flagReason: string | null;
  /** The fact the assistant did not have, when that was the problem. */
  missingKnowledge: string | null;
  callerMood: CallerMood | null;
  needsAttention: boolean;
  urgency: CallUrgency | null;
  urgencyLabel: string | null;
  /** Badge colouring, keyed off the band the score falls in. */
  toneClass: string;
};

/** Shown wherever a converted score appears, so nobody reads it as a verdict. */
export const LEGACY_SCORE_NOTE =
  "Scored before calls were sorted by kind. The number is the old ranking converted to 1–10, not a judgement the current rubric made. Re-score to judge it properly.";

function toNumber(value: number | null): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Green at 8+, amber in the middle, red at 3 and below: on the 1–10 scale.
 * Legacy rows are deliberately left neutral: their number is a converted rank,
 * not a judgement the current rubric ever made, and colouring it would dress
 * up a guess as a verdict.
 */
function toneFor(score: number | null, legacy: boolean): string {
  if (legacy || score == null) return "text-muted-foreground";
  if (score >= 8) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 4) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

/** True for a row the current rubric has not judged, whatever the old one said. */
export function isLegacyCallScore(call: PhoneCallRow): boolean {
  const version =
    typeof call.score_breakdown?.version === "number"
      ? call.score_breakdown.version
      : null;
  return (
    call.scored_at != null &&
    (version === null || version < PHONE_CALL_SCORING_VERSION)
  );
}

export function describeCallScore(call: PhoneCallRow): CallScoreView {
  const breakdown = call.score_breakdown ?? null;
  const legacy = isLegacyCallScore(call);

  const classification =
    call.call_classification ?? (breakdown?.call_type as CallClassification | undefined) ?? null;

  const urgency = call.urgency ?? (breakdown?.urgency as CallUrgency | undefined) ?? null;

  const value = toNumber(call.ai_score);

  return {
    value,
    // 0070 rescaled every converted score into 1–10, so the denominator is 10
    // for both rubrics. A value still above 10 is a row that migration never
    // reached, and the only honest label for it is the scale it was given on.
    outOf: value != null && value > 10 ? 100 : 10,
    legacy,
    classification,
    classificationLabel: classification
      ? CLASSIFICATION_LABELS[classification]
      : null,
    classificationHelp: classification
      ? CLASSIFICATION_DESCRIPTIONS[classification]
      : null,
    summary: firstString(breakdown?.summary, breakdown?.rationale, call.outcome, call.notes),
    flagReason: firstString(breakdown?.flag_reason),
    missingKnowledge: firstString(breakdown?.missing_knowledge),
    callerMood: (breakdown?.caller_mood as CallerMood | undefined) ?? null,
    needsAttention:
      call.notify_pastor ?? (breakdown?.notify_pastor as boolean | undefined) ?? false,
    urgency,
    urgencyLabel: urgency ? URGENCY_LABELS[urgency] : null,
    toneClass: toneFor(legacy ? null : value, legacy),
  };
}

/** "8 / 10", or "" when the call has not been scored. */
export function formatCallScore(view: CallScoreView): string {
  if (view.value == null) return "";
  return `${view.value} / ${view.outOf}`;
}
