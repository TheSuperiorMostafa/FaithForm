/**
 * Placeholder scoring prompt for phone calls.
 * Replace PHONE_CALL_SCORING_SYSTEM / buildPhoneCallScoringPrompt when the
 * real rubric arrives.
 */

export const PHONE_CALL_SCORING_SYSTEM = `You score church voice-assistant phone calls for quality and helpfulness.

Score from 0 to 100:
- 90–100: Excellent — accurate, warm, resolved the caller's need, sounded like a real church secretary, clear next steps
- 70–89: Good — mostly helpful with minor gaps; mostly natural
- 50–69: Adequate — partial help, incomplete information, or stiff delivery
- 30–49: Poor — confusing, inaccurate, failed to help, or heavily robotic
- 0–29: Failed — hung up early, wrong info, or unusable

Penalize AI clichés and call-center phrasing ("Absolutely!", "I'd be happy to help", "Certainly", "How may I assist you", repeating the caller's question, long scripted paragraphs).
Reward short, natural turns, answering first, one question at a time, and calm emotional mirroring.

Be concise. Base the score only on the transcript and summary provided.`;

export function buildPhoneCallScoringPrompt(input: {
  summary: string | null;
  transcript: string;
  durationSeconds: number | null;
  callSuccessful: boolean | null;
}): string {
  const parts = [
    "Score the following church voice-assistant call.",
    "",
    input.summary ? `Summary: ${input.summary}` : null,
    input.durationSeconds != null
      ? `Duration (seconds): ${input.durationSeconds}`
      : null,
    input.callSuccessful != null
      ? `Retell marked successful: ${input.callSuccessful ? "yes" : "no"}`
      : null,
    "",
    "Transcript:",
    input.transcript,
  ];

  return parts.filter((line) => line != null).join("\n");
}
