/**
 * The rubric the church AI model applies to a finished phone call.
 *
 * ## Why this is shaped the way it is
 *
 * The first version of this file scored every call 0–100 on "was this a good
 * call", which quietly punished the assistant for the calls it handled best.
 * A Google Business Listing robocall that the assistant recognised and hung up
 * on is a *win* for the church, but "did the caller get what they wanted" reads
 * it as a total failure — so the spam that churches get most of scored lowest,
 * and the score column stopped meaning anything.
 *
 * So the rubric classifies before it scores. A call is triaged into one of four
 * kinds, and each kind is judged on its own terms: spam is scored on how
 * cleanly the assistant refused, an empty line is not scored at all, and only
 * genuine calls are scored on whether the caller was actually helped.
 *
 * The scale is 1–10 rather than 0–100 because nobody can tell an 82 from a 78,
 * and a ten-point scale is what the rubric's bands actually describe.
 */

export const PHONE_CALL_SCORING_VERSION = 2;

export const CALL_CLASSIFICATIONS = [
  "spam",
  "no_engagement",
  "vendor",
  "real",
] as const;
export type CallClassification = (typeof CALL_CLASSIFICATIONS)[number];

export const CALL_LABELS = ["unsuccessful", "neutral", "successful"] as const;
export type CallLabel = (typeof CALL_LABELS)[number];

export const CALLER_MOODS = [
  "frustrated",
  "neutral",
  "satisfied",
  "confused",
] as const;
export type CallerMood = (typeof CALLER_MOODS)[number];

export const CALL_URGENCIES = ["high", "normal", "low"] as const;
export type CallUrgency = (typeof CALL_URGENCIES)[number];

export const CLASSIFICATION_LABELS: Record<CallClassification, string> = {
  spam: "Spam",
  no_engagement: "No engagement",
  vendor: "Vendor",
  real: "Real call",
};

/**
 * What each classification means, in the words a pastor would use. Rendered on
 * the call log's "how scoring works" panel and on the call detail page, so the
 * number on screen is never unexplained.
 */
export const CLASSIFICATION_DESCRIPTIONS: Record<CallClassification, string> = {
  spam: "A robocall, scam, or automated sales pitch. Scored on how cleanly the assistant refused it — a scam that fails is a win.",
  no_engagement:
    "Nobody spoke: a hang-up, dead air, or a wrong number. Always scored 5, because there is nothing to judge.",
  vendor:
    "A real person selling something — cleaning, roofing, directories. Scored on how the assistant handled them.",
  real: "A genuine church call. Scored on whether the caller actually got what they needed.",
};

export const URGENCY_LABELS: Record<CallUrgency, string> = {
  high: "Urgent",
  normal: "Needs a reply",
  low: "No action needed",
};

type ScoringChurchContext = {
  /** The assistant's name, so the model never mistakes it for the caller. */
  assistantName: string;
  churchName: string;
  /**
   * Follows the church's own `voice_gender` choice. A male-voiced assistant
   * scored with "she" reads to the model as a third party in the room, which
   * is the exact role confusion the opening paragraph exists to prevent.
   */
  voiceGender?: "male" | "female" | null;
};

type Pronouns = { subject: string; reflexive: string };

function pronounsFor(voiceGender: "male" | "female" | null | undefined): Pronouns {
  if (voiceGender === "female") return { subject: "she", reflexive: "herself" };
  if (voiceGender === "male") return { subject: "he", reflexive: "himself" };
  return { subject: "they", reflexive: "themselves" };
}

/**
 * The single most common scoring failure is role confusion: the transcript
 * opens with the assistant's greeting, the model reads that as the caller
 * introducing themselves, and every judgement after it is inverted. Naming both
 * parties up front, and saying explicitly who greets first, fixes it.
 */
export function buildPhoneCallScoringSystem({
  assistantName,
  churchName,
  voiceGender,
}: ScoringChurchContext): string {
  const { subject, reflexive } = pronounsFor(voiceGender);

  return `You are evaluating the performance of ${assistantName}, an AI phone receptionist for ${churchName}. ${assistantName} is the AGENT who answers the phone. The other party is the CALLER. Never confuse these roles — if the transcript opens with a greeting from ${churchName}, that is ${assistantName}.

STEP 1 — Classify the call:
- spam: robocalls, scams, automated solicitations (especially Google Business Listing scams), pre-recorded sales messages
- no_engagement: ${assistantName} greets but the caller never speaks, hangs up immediately, wrong number, dead air, or the transcript is empty
- vendor: a real human selling or soliciting services (cleaning, roofing, striping, directories)
- real: any genuine church-related call — service times, rentals, assistance requests, messages for staff, property questions, member questions

STEP 2 — Score based on classification:

If spam: score how well ${assistantName} handled it, not whether the caller got what they wanted. Correctly identifying the scam, declining, and ending the call cleanly is a 10. Getting manipulated, pressing options, or giving out information is a 1. A scam that fails is a SUCCESS for the church.

If no_engagement: score exactly 5, label neutral. There is nothing to evaluate.

If vendor or real: score ${assistantName}'s performance:
10: Fully resolved, warm, accurate, nothing left hanging
8-9: Resolved with minor friction or a small missed opportunity
6-7: Partially handled; correct information given but the caller's actual need was not fully met
4-5: ${assistantName} deflected, redirected, or took a message when ${subject} could have helped, or the caller left without what they needed
2-3: ${assistantName} gave wrong information, contradicted ${reflexive}, blocked a legitimate request, or repeated a question already answered
1: ${assistantName} claimed to be human, promised something ${subject} cannot do, or invented a fact

HARD RULES:
- If ${assistantName} claims to be a live person or denies being AI, score 1 regardless of anything else.
- If ${assistantName} promises a callback, a lookup, or any action ${subject} cannot actually perform, score 1.
- If ${assistantName} tells a caller a date is unavailable when that caller is the existing reservation holder, score 2.
- Do not penalize ${assistantName} for refusing scams, declining to give financial assistance, or routing something to the church office when that is genuinely the correct answer.

STEP 3 — Decide whether to notify the pastor:
Set notify_pastor true for real calls that a human at the church needs to know about: someone in crisis, a member or visitor, an unresolved request, a property or building matter, a repeat caller, or anything where a person is waiting on a response. Set false for spam, no_engagement, and routine questions ${assistantName} fully answered (service times, address, hours).

Set urgency:
- high: crisis, distress, bereavement, safety, or someone in immediate need
- normal: a real person waiting on a response
- low: informational, handled, or no action needed

In the summary, name ${assistantName} as the agent. Write 2-3 sentences describing what the caller wanted and how ${assistantName} handled it.`;
}

export function buildPhoneCallScoringPrompt(input: {
  summary: string | null;
  transcript: string;
  durationSeconds: number | null;
  callSuccessful: boolean | null;
}): string {
  const parts = [
    "TRANSCRIPT:",
    input.transcript,
    "",
    input.summary ? `Retell's own summary: ${input.summary}` : null,
    input.durationSeconds != null
      ? `Duration (seconds): ${input.durationSeconds}`
      : null,
    input.callSuccessful != null
      ? `Retell marked successful: ${input.callSuccessful ? "yes" : "no"}`
      : null,
  ];

  return parts.filter((line) => line != null).join("\n");
}
