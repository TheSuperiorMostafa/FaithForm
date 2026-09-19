/**
 * The rubric the church AI model applies to a finished phone call.
 *
 * ## Why this is shaped the way it is
 *
 * The first version of this file scored every call 0–100 on "was this a good
 * call", which quietly punished the assistant for the calls it handled best.
 * A Google Business Listing robocall that the assistant recognised and hung up
 * on is a *win* for the church, but "did the caller get what they wanted" reads
 * it as a total failure, so the spam that churches get most of scored lowest,
 * and the score column stopped meaning anything.
 *
 * So the rubric classifies before it scores. A call is triaged into one of four
 * kinds, and each kind is judged on its own terms: spam is scored on how
 * cleanly the assistant refused, an empty line is not scored at all, and only
 * genuine calls are scored on whether the caller was actually helped.
 *
 * The scale is 1–10 rather than 0–100 because nobody can tell an 82 from a 78,
 * and a ten-point scale is what the rubric's bands actually describe.
 *
 * ## Names come from the transcript, never from settings
 *
 * Version 2 handed the model the assistant name saved in FaithForm, told it
 * that name was the agent, and told it to use the name in every summary. But
 * a linked agent is built in Retell and never receives that name, and even a
 * managed one may have greeted callers under an older name. So summaries,
 * "what went wrong" and "what the assistant did not know" credited calls to a
 * name nobody on the line had used, and church staff asked who that was. Now
 * the model says "the assistant" and "the caller", and uses a name only when
 * someone says it in the transcript.
 */

/**
 * Stamped on every breakdown as `version`, so the log knows which rules judged
 * a call:
 *
 * 1. The retired 0–100 rubric. Migration 0070 stamped these rows.
 * 2. Sort by kind, then score 1–10.
 * 3. The same rubric, with names taken only from the transcript.
 *
 * "Re-score older calls" offers every call stamped below this, so raising it is
 * how a prompt fix reaches calls that were scored before it.
 */
export const PHONE_CALL_SCORING_VERSION = 3;

/**
 * The first version that sorted calls by kind and scored them 1–10 itself.
 * Anything older carries a converted rank rather than a verdict, and the log
 * shows it that way. A call from a later version that is merely out of date
 * still has a real kind and score, so it is shown normally until re-scored.
 */
export const FIRST_SORTED_SCORING_VERSION = 2;

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
  spam: "A robocall, scam, or automated sales pitch. Scored on how cleanly the assistant refused it: a scam that fails is a win.",
  no_engagement:
    "Nobody spoke: a hang-up, dead air, or a wrong number. Always scored 5, because there is nothing to judge.",
  vendor:
    "A real person selling something: cleaning, roofing, directories. Scored on how the assistant handled them.",
  real: "A genuine church call. Scored on whether the caller actually got what they needed.",
};

/**
 * The name rule, repeated on every written field of the output schema. The
 * model reads a field's description at the moment it writes that field, which
 * is where an invented name would slip in.
 */
export const NAMES_FROM_TRANSCRIPT_ONLY =
  'Say "the assistant" and "the caller". Use a name only if it is said in the transcript; never invent one.';

/**
 * What each written field is for. The system prompt and the output schema both
 * read from here, so the two can never describe a field differently.
 */
export const WRITTEN_FIELD_GUIDE = {
  summary:
    "2-3 sentences on what the caller wanted and how the assistant handled it.",
  flag_reason: "What the assistant got wrong, or null if it got nothing wrong.",
  missing_knowledge:
    "A fact about the church the assistant needed but did not have, or null.",
} as const;

export type ScoringChurchContext = {
  churchName: string;
  /**
   * The name the church saved for its assistant, offered only as a hint. It is
   * null for a linked agent: that agent is built in Retell and FaithForm never
   * sends it this name, so the voice on the call may use another one.
   */
  assistantNameHint?: string | null;
  /**
   * Follows the church's own `voice_gender` choice. A male-voiced assistant
   * scored with "she" reads to the model as a third party in the room, which
   * is the exact role confusion the opening section exists to prevent.
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
 * introducing themselves, and every judgement after it is inverted. Retell
 * labels every line "Agent:" or "User:", so the prompt says which is which and
 * who greets first.
 *
 * The second is a made-up name, and the fix is the same: the transcript is
 * the only source of names. The saved assistant name is offered as a hint the
 * transcript has to confirm, never as a fact, and every rule refers to "the
 * assistant" so there is no name in here for the model to repeat.
 */
export function buildPhoneCallScoringSystem({
  churchName,
  assistantNameHint,
  voiceGender,
}: ScoringChurchContext): string {
  const { subject, reflexive } = pronounsFor(voiceGender);

  // Collapsed so a stray line break in a saved name cannot split the rule.
  const hint = assistantNameHint?.replace(/\s+/g, " ").trim();
  const hintRule = hint
    ? `\n- The church calls its assistant "${hint}". That is a hint, not a fact about this call: use "${hint}" only if an "Agent:" line in this transcript has the assistant say it. Otherwise say "the assistant".`
    : "";

  return `You are reviewing a finished phone call to ${churchName}. The church's AI phone assistant answered the call, and your job is to judge how well the assistant handled it.

WHO IS WHO:
- Each transcript line starts with its speaker. Lines that start with "Agent:" are the church's AI phone assistant. Lines that start with "User:" are the caller.
- The assistant answers the phone, so the call usually opens with its greeting. A greeting from ${churchName} is the assistant speaking, not the caller introducing themselves. Never confuse these roles.

NAMES:
- Refer to the assistant as "the assistant". Use a name for it only if an "Agent:" line in the transcript has the assistant say that name itself.${hintRule}
- Refer to the caller as "the caller". Use the caller's name only if the caller says it in the transcript.
- Name anyone else, such as a pastor, a staff member, or a family member, only if that name is said in the transcript.
- Never invent, guess, or fill in a name. A name that appears only in Retell's summary, or only in these instructions, does not count. When unsure, leave the name out.
- These rules apply to every field you write: summary, flag_reason, and missing_knowledge.

STEP 1: Classify the call:
- spam: robocalls, scams, automated solicitations (especially Google Business Listing scams), pre-recorded sales messages
- no_engagement: the assistant greets but the caller never speaks, hangs up immediately, wrong number, dead air, or the transcript is empty
- vendor: a real human selling or soliciting services (cleaning, roofing, striping, directories)
- real: any genuine church-related call: service times, rentals, assistance requests, messages for staff, property questions, member questions

STEP 2: Score based on classification:

If spam: score how well the assistant handled it, not whether the caller got what they wanted. Correctly identifying the scam, declining, and ending the call cleanly is a 10. Getting manipulated, pressing options, or giving out information is a 1. A scam that fails is a SUCCESS for the church.

If no_engagement: score exactly 5, label neutral. There is nothing to evaluate.

If vendor or real: score the assistant's performance:
10: Fully resolved, warm, accurate, nothing left hanging
8-9: Resolved with minor friction or a small missed opportunity
6-7: Partially handled; correct information given but the caller's actual need was not fully met
4-5: The assistant deflected, redirected, or took a message when ${subject} could have helped, or the caller left without what they needed
2-3: The assistant gave wrong information, contradicted ${reflexive}, blocked a legitimate request, or repeated a question already answered
1: The assistant claimed to be human, promised something ${subject} cannot do, or invented a fact

HARD RULES:
- If the assistant claims to be a live person or denies being AI, score 1 regardless of anything else.
- If the assistant promises a callback, a lookup, or any action ${subject} cannot actually perform, score 1.
- If the assistant tells a caller a date is unavailable when that caller is the existing reservation holder, score 2.
- Do not penalize the assistant for refusing scams, declining to give financial assistance, or routing something to the church office when that is genuinely the correct answer.

STEP 3: Decide whether to notify the pastor:
Set notify_pastor true for real calls that a human at the church needs to know about: someone in crisis, a member or visitor, an unresolved request, a property or building matter, a repeat caller, or anything where a person is waiting on a response. Set false for spam, no_engagement, and routine questions the assistant fully answered (service times, address, hours).

Set urgency:
- high: crisis, distress, bereavement, safety, or someone in immediate need
- normal: a real person waiting on a response
- low: informational, handled, or no action needed

STEP 4: Write it up, following the NAMES rules in every field:
- summary: ${WRITTEN_FIELD_GUIDE.summary}
- flag_reason: ${WRITTEN_FIELD_GUIDE.flag_reason}
- missing_knowledge: ${WRITTEN_FIELD_GUIDE.missing_knowledge}`;
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
