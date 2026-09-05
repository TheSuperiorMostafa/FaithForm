import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiGenerateObject } from "@/lib/ai";
import {
  buildPhoneCallScoringPrompt,
  buildPhoneCallScoringSystem,
  CALL_LABELS,
  CALL_URGENCIES,
  CALLER_MOODS,
  CALL_CLASSIFICATIONS,
  PHONE_CALL_SCORING_VERSION,
} from "@/lib/integrations/phone-call-scoring-prompt";
import { createAdminClient } from "@/lib/supabase/admin";

export const phoneCallScoreSchema = z.object({
  call_type: z.enum(CALL_CLASSIFICATIONS),
  score: z.number().min(1).max(10),
  label: z.enum(CALL_LABELS),
  summary: z.string().min(1).max(2000),
  caller_mood: z.enum(CALLER_MOODS),
  flag_reason: z.string().max(1000).nullable(),
  notify_pastor: z.boolean(),
  urgency: z.enum(CALL_URGENCIES),
  missing_knowledge: z.string().max(1000).nullable(),
});

export type PhoneCallScoreBreakdown = z.infer<typeof phoneCallScoreSchema> & {
  /** Which rubric produced this row, so old 0–100 scores stay legible. */
  version: number;
};

type ScorePhoneCallOptions = {
  force?: boolean;
  admin?: SupabaseClient;
};

/** The rubric fixes this one: an empty line has nothing to judge. */
const NO_ENGAGEMENT_SCORE = 5;

function buildNoEngagementBreakdown(reason: string): PhoneCallScoreBreakdown {
  return {
    version: PHONE_CALL_SCORING_VERSION,
    call_type: "no_engagement",
    score: NO_ENGAGEMENT_SCORE,
    label: "neutral",
    summary: reason,
    caller_mood: "neutral",
    flag_reason: null,
    notify_pastor: false,
    urgency: "low",
    missing_knowledge: null,
  };
}

/**
 * Who the model is being asked to judge. Without this the rubric has to talk
 * about "the assistant" in the abstract, and a transcript that opens with the
 * assistant's own greeting gets read as the caller speaking.
 */
async function loadScoringContext(
  churchId: string,
  client: SupabaseClient,
): Promise<{
  assistantName: string;
  churchName: string;
  voiceGender: "male" | "female" | null;
}> {
  const [{ data: church }, { data: settings }] = await Promise.all([
    client.from("churches").select("name").eq("id", churchId).maybeSingle(),
    client
      .from("voice_assistant_settings")
      .select("assistant_name, voice_gender")
      .eq("church_id", churchId)
      .maybeSingle(),
  ]);

  const voiceGender = settings?.voice_gender as string | null | undefined;

  return {
    assistantName:
      (settings?.assistant_name as string | null)?.trim() ||
      "the church's AI receptionist",
    churchName: (church?.name as string | null)?.trim() || "the church",
    voiceGender:
      voiceGender === "female" || voiceGender === "male" ? voiceGender : null,
  };
}

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

  // A silent call is a classification, not a missing one. Recording it here
  // keeps hang-ups out of the "not yet scored" pile they used to sit in
  // forever, and spends no model call on a transcript with nothing in it.
  if (!transcript) {
    return persistBreakdown(
      client,
      phoneCallId,
      buildNoEngagementBreakdown(
        "No transcript was recorded — the caller hung up, said nothing, or the line was dead.",
      ),
    );
  }

  try {
    const context = await loadScoringContext(call.church_id as string, client);

    const { object } = await aiGenerateObject({
      churchId: call.church_id as string,
      system: buildPhoneCallScoringSystem(context),
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

    // The rubric fixes no_engagement at 5/neutral. Models drift on that under
    // a long transcript of hold music, so it is pinned here rather than hoped for.
    const normalized: PhoneCallScoreBreakdown =
      object.call_type === "no_engagement"
        ? {
            ...object,
            version: PHONE_CALL_SCORING_VERSION,
            score: NO_ENGAGEMENT_SCORE,
            label: "neutral",
            notify_pastor: false,
          }
        : { ...object, version: PHONE_CALL_SCORING_VERSION };

    return persistBreakdown(client, phoneCallId, normalized);
  } catch (err) {
    console.error("[score-phone-call] scoring failed", phoneCallId, err);
    return null;
  }
}

/**
 * The three lifted columns are a query convenience, not the record itself —
 * `score_breakdown` already holds every one of them. So on a database that has
 * not had 0070 applied, the score is still written rather than lost, and the
 * columns fill in when the migration lands.
 */
async function persistBreakdown(
  client: SupabaseClient,
  phoneCallId: string,
  breakdown: PhoneCallScoreBreakdown,
): Promise<PhoneCallScoreBreakdown | null> {
  const core = {
    ai_score: breakdown.score,
    score_breakdown: breakdown,
    scored_at: new Date().toISOString(),
  };

  const write = (patch: Record<string, unknown>) =>
    client.from("phone_calls").update(patch).eq("id", phoneCallId);

  let { error } = await write({
    ...core,
    call_classification: breakdown.call_type,
    notify_pastor: breakdown.notify_pastor,
    urgency: breakdown.urgency,
  });

  if (error && /call_classification|notify_pastor|urgency/i.test(error.message)) {
    ({ error } = await write(core));
  }

  if (error) {
    console.error("[score-phone-call] update failed", phoneCallId, error);
    return null;
  }

  return breakdown;
}
