import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiGenerateObject } from "@/lib/ai";
import {
  PHONE_CALL_SCORING_SYSTEM,
  buildPhoneCallScoringPrompt,
} from "@/lib/integrations/phone-call-scoring-prompt";
import { createAdminClient } from "@/lib/supabase/admin";

export const phoneCallScoreSchema = z.object({
  score: z.number().min(0).max(100),
  rationale: z.string().min(1).max(2000),
});

export type PhoneCallScoreBreakdown = z.infer<typeof phoneCallScoreSchema>;

type ScorePhoneCallOptions = {
  force?: boolean;
  admin?: SupabaseClient;
};

/**
 * Score a phone call transcript with the church AI model.
 * Soft-fails (logs + returns null) so webhook/import paths stay resilient.
 */
export async function scorePhoneCallIfNeeded(
  phoneCallId: string,
  options: ScorePhoneCallOptions = {},
): Promise<PhoneCallScoreBreakdown | null> {
  const client = options.admin ?? createAdminClient();

  const { data: call, error } = await client
    .from("phone_calls")
    .select(
      "id, church_id, transcript, outcome, notes, duration_seconds, call_successful, scored_at",
    )
    .eq("id", phoneCallId)
    .maybeSingle();

  if (error || !call) {
    console.error("[score-phone-call] call not found", phoneCallId, error);
    return null;
  }

  if (call.scored_at && !options.force) {
    return null;
  }

  const transcript = (call.transcript as string | null)?.trim();
  if (!transcript) {
    return null;
  }

  try {
    const { object } = await aiGenerateObject({
      churchId: call.church_id as string,
      system: PHONE_CALL_SCORING_SYSTEM,
      prompt: buildPhoneCallScoringPrompt({
        summary:
          (call.outcome as string | null) ?? (call.notes as string | null),
        transcript,
        durationSeconds: call.duration_seconds as number | null,
        callSuccessful: call.call_successful as boolean | null,
      }),
      schema: phoneCallScoreSchema,
      maxOutputTokens: 1024,
    });

    const breakdown: PhoneCallScoreBreakdown = {
      score: object.score,
      rationale: object.rationale,
    };

    const { error: updateError } = await client
      .from("phone_calls")
      .update({
        ai_score: breakdown.score,
        score_breakdown: breakdown,
        scored_at: new Date().toISOString(),
      })
      .eq("id", phoneCallId);

    if (updateError) {
      console.error("[score-phone-call] update failed", phoneCallId, updateError);
      return null;
    }

    return breakdown;
  } catch (err) {
    console.error("[score-phone-call] scoring failed", phoneCallId, err);
    return null;
  }
}
