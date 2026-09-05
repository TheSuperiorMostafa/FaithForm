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
 * Two rubrics are in the table at once — 0–100 rows from before migration 0070
 * and 1–10 rows after it — and a "7" means opposite things in each. Rather than
 * letting each component guess, every read goes through here, and a legacy row
 * says so out loud instead of quietly showing a 7 that used to be a 70.
 */
export type CallScoreView = {
  /** Rounded, in whatever scale this row was actually scored on. */
  value: number | null;
  outOf: 10 | 100;
  /** Scored by the retired 0–100 rubric, so it has no classification. */
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
 * Green at 8+, amber in the middle, red at 3 and below — on the 1–10 scale.
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

export function describeCallScore(call: PhoneCallRow): CallScoreView {
  const breakdown = call.score_breakdown ?? null;
  const version =
    typeof breakdown?.version === "number" ? breakdown.version : null;
  const legacy = call.scored_at != null && version !== null && version < PHONE_CALL_SCORING_VERSION;

  const classification =
    call.call_classification ?? (breakdown?.call_type as CallClassification | undefined) ?? null;

  const urgency = call.urgency ?? (breakdown?.urgency as CallUrgency | undefined) ?? null;

  const value = toNumber(call.ai_score);

  return {
    value,
    outOf: legacy ? 100 : 10,
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

/** "8 / 10", or "—" when the call has not been scored. */
export function formatCallScore(view: CallScoreView): string {
  if (view.value == null) return "—";
  return `${view.value} / ${view.outOf}`;
}
