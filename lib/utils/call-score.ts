import {
  CLASSIFICATION_DESCRIPTIONS,
  CLASSIFICATION_LABELS,
  FIRST_SORTED_SCORING_VERSION,
  PHONE_CALL_SCORING_VERSION,
  type CallClassification,
  type CallerMood,
  type CallUrgency,
} from "@/lib/integrations/phone-call-scoring-prompt";
import type {
  PhoneCallRow,
  PhoneCallScoreBreakdown,
} from "@/types/voice-assistant";

/**
 * One place that decides what a scored call looks like on screen.
 *
 * Two rubrics have written to this table. Rows judged by the retired 0–100
 * rubric were rescaled to 1–10 by migration 0070 and stamped `version: 1`, so
 * their number sits on the same scale as everything else but is a converted
 * rank, not a verdict the current rubric made. Every read goes through here so
 * a converted row is shown uncoloured and says so, rather than each component
 * guessing.
 *
 * A row can also be out of date without being legacy: sorted and scored by
 * today's rubric, but under an earlier prompt. Its kind and number are real,
 * so it is shown normally; only the re-score button treats it as older.
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
  /**
   * A caller in crisis: distress, a bereavement, a safety worry, someone in
   * immediate need. It is the only urgency the log shows. A pilot church
   * asked for the "Needs a reply" flag to go, so the rubric's other urgency
   * levels and its notify_pastor flag are still saved on the row but never
   * shown.
   */
  urgent: boolean;
  /** Badge colouring, keyed off the band the score falls in. */
  toneClass: string;
};

/** Shown wherever a converted score appears, so nobody reads it as a verdict. */
export const LEGACY_SCORE_NOTE =
  "Scored before calls were sorted by kind. The number is the old ranking converted to 1–10, not a judgement the current rubric made. Re-score to judge it properly.";

/**
 * On the re-score button, which covers converted rows and also calls scored
 * under an earlier version of today's rules.
 */
export const OLDER_SCORE_NOTE =
  "These calls were scored under older rules. Re-scoring reads each call again and writes a fresh score and summary.";

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

function scoreVersion(
  breakdown: PhoneCallScoreBreakdown | null | undefined,
): number | null {
  return typeof breakdown?.version === "number" ? breakdown.version : null;
}

/**
 * True for a row the retired 0–100 rubric scored: it has no kind, and its
 * number is a converted rank rather than a verdict.
 */
export function isLegacyCallScore(call: PhoneCallRow): boolean {
  const version = scoreVersion(call.score_breakdown);
  return (
    call.scored_at != null &&
    (version === null || version < FIRST_SORTED_SCORING_VERSION)
  );
}

/**
 * True for a breakdown written under older rules than today's. Both the
 * button's count and the action that re-scores go through this, so they
 * always agree on which calls are older.
 */
export function isOutdatedScoreBreakdown(
  breakdown: PhoneCallScoreBreakdown | null | undefined,
): boolean {
  const version = scoreVersion(breakdown);
  return version === null || version < PHONE_CALL_SCORING_VERSION;
}

/**
 * True for a scored call that "Re-score older calls" should judge again: a
 * legacy row, or one whose summary was written before names had to come from
 * the transcript.
 */
export function isOutdatedCallScore(
  call: Pick<PhoneCallRow, "scored_at" | "score_breakdown">,
): boolean {
  return call.scored_at != null && isOutdatedScoreBreakdown(call.score_breakdown);
}

export function describeCallScore(call: PhoneCallRow): CallScoreView {
  const breakdown = call.score_breakdown ?? null;
  const legacy = isLegacyCallScore(call);

  const classification =
    call.call_classification ?? (breakdown?.call_type as CallClassification | undefined) ?? null;

  const urgency = call.urgency ?? (breakdown?.urgency as CallUrgency | undefined) ?? null;
  const notifyPastor =
    call.notify_pastor ?? (breakdown?.notify_pastor as boolean | undefined) ?? false;

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
    // The same condition that turned the old badge red. notify_pastor still
    // guards it, so a robocall that sounds urgent never turns red.
    urgent: urgency === "high" && notifyPastor === true,
    toneClass: toneFor(legacy ? null : value, legacy),
  };
}

/** "8 / 10", or "" when the call has not been scored. */
export function formatCallScore(view: CallScoreView): string {
  if (view.value == null) return "";
  return `${view.value} / ${view.outOf}`;
}

// ---------------------------------------------------------------------------
// Who needs a call back
// ---------------------------------------------------------------------------

/** The church's own words for where a call stands (audit §8.4: Call). */
export type CallFollowUpTone = "attention" | "done" | "neutral";

export type CallFollowUp = {
  /** A real caller the rubric said a person at the church should ring back. */
  needsCallBack: boolean;
  /** Needs a call back, and the caller sounded like they were in crisis. */
  urgent: boolean;
  /** Someone at the church marked it handled. */
  handled: boolean;
  label: string;
  tone: CallFollowUpTone;
};

const QUIET_LABELS: Record<CallClassification, string> = {
  spam: "Spam",
  no_engagement: "No one spoke",
  vendor: "Sales call",
  real: "Answered",
};

/**
 * Whether a person at the church should ring this caller back, from what the
 * scorer already saved: the kind of call, whether a human needs to know
 * (`notify_pastor`) and how urgent it is. Spam, silent lines and sales calls
 * never count, even when they sounded urgent. A call someone has marked
 * handled drops out of the list.
 */
export function describeCallFollowUp(
  call: Pick<
    PhoneCallRow,
    "call_classification" | "notify_pastor" | "urgency" | "score_breakdown"
  >,
  handledAt: string | null = null,
): CallFollowUp {
  const breakdown = call.score_breakdown ?? null;
  const classification =
    call.call_classification ??
    (breakdown?.call_type as CallClassification | undefined) ??
    null;
  const flagged =
    call.notify_pastor ?? (breakdown?.notify_pastor as boolean | undefined) ?? false;
  const urgency =
    call.urgency ?? (breakdown?.urgency as CallUrgency | undefined) ?? null;

  const isPerson = classification === "real" || classification === null;
  const wanted = isPerson && flagged === true;
  const handled = Boolean(handledAt);
  const needsCallBack = wanted && !handled;
  const urgent = needsCallBack && urgency === "high";

  if (handled) return { needsCallBack, urgent, handled, label: "Handled", tone: "done" };
  if (urgent) {
    return { needsCallBack, urgent, handled, label: "Urgent: call back", tone: "attention" };
  }
  if (needsCallBack) {
    return { needsCallBack, urgent, handled, label: "Needs a call back", tone: "attention" };
  }
  return {
    needsCallBack,
    urgent,
    handled,
    label: classification ? QUIET_LABELS[classification] : "Not sorted yet",
    tone: classification === "real" ? "done" : "neutral",
  };
}

/** Urgent calls first, then the newest. Does not change the input. */
export function sortCallsForFollowUp<T extends { urgent: boolean; calledAt: string }>(
  calls: readonly T[],
): T[] {
  return [...calls].sort((a, b) => {
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    return new Date(b.calledAt).getTime() - new Date(a.calledAt).getTime();
  });
}
