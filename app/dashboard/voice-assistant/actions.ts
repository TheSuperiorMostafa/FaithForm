"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireChurchAuth } from "@/lib/auth/church";
import { featureActionError } from "@/lib/features/guard";
import { RetellLinkedAgentError, syncRetellAgent } from "@/lib/integrations/retell";
import {
  provisionRetellPhoneForChurch,
  syncRetellPhoneForChurch,
} from "@/lib/integrations/retell-phone";
import { importRetellCallsForChurch } from "@/lib/integrations/retell-calls";
import { PHONE_CALL_SCORING_VERSION } from "@/lib/integrations/phone-call-scoring-prompt";
import { scorePhoneCallIfNeeded } from "@/lib/integrations/score-phone-call";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getPhoneCallById,
  upsertVoiceAssistantSettings,
} from "@/lib/queries/voice-assistant";
import {
  SPEAKING_PACES,
  VOICE_GENDERS,
  VOICE_TONES,
} from "@/types/voice-assistant";
import { createClient } from "@/lib/supabase/server";

const saveSchema = z
  .object({
    assistantName: z
      .string()
      .trim()
      .min(2, "Assistant name is required")
      .max(80),
    emergencyPhone: z.string().max(30),
    tone: z.enum(VOICE_TONES),
    speakingPace: z.enum(SPEAKING_PACES),
    voiceGender: z.enum(VOICE_GENDERS),
    language: z.string().max(10),
    signoffMessage: z.string().max(1000),
    afterHoursEnabled: z.boolean(),
    afterHoursMessage: z.string().max(2000),
  })
  .superRefine((data, ctx) => {
    if (
      data.afterHoursEnabled &&
      data.afterHoursMessage.trim().length < 10
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "After-hours message is required when after-hours is on",
        path: ["afterHoursMessage"],
      });
    }
  });

export type SaveVoiceAssistantResult =
  | { ok: true; agentId?: string }
  | { error: string };

export type ImportCallsResult =
  | { ok: true; imported: number }
  | { error: string };

export type RescoreCallResult =
  | { ok: true; score: number | null }
  | { error: string };

export type ProvisionPhoneResult =
  | { ok: true; phoneNumber: string; created: boolean }
  | { error: string };

export type SyncPhoneResult =
  | { ok: true; phoneNumber: string | null }
  | { error: string };

export async function saveVoiceAssistantSettings(
  input: z.infer<typeof saveSchema>,
): Promise<SaveVoiceAssistantResult> {
  const auth = await requireChurchAuth();

  const denied = await featureActionError("voice_assistant");
  if (denied) return { error: denied };

  if (!auth.isAdmin) {
    return { error: "Only church admins can update voice assistant settings." };
  }

  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message;
    return {
      error: first ?? "Please complete the required fields and try again.",
    };
  }

  try {
    await upsertVoiceAssistantSettings(auth.churchId, parsed.data);

    let agentId: string | undefined;
    try {
      const sync = await syncRetellAgent(auth.churchId);
      agentId = sync?.agentId;
    } catch (err) {
      if (err instanceof RetellLinkedAgentError) {
        // Linked churches manage their agent directly in Retell: the save
        // above already updated FaithForm's own records, so this is not a
        // failure, just a routine no-op.
        revalidatePath("/dashboard/voice-assistant");
        revalidatePath("/dashboard");
        return { ok: true };
      }
      console.error("[voice-assistant] Retell sync error", err);
      return {
        error:
          "Settings saved, but we could not update your phone assistant. Please try saving again.",
      };
    }

    revalidatePath("/dashboard/voice-assistant");
    revalidatePath("/dashboard");
    return { ok: true, agentId };
  } catch {
    return { error: "Something went wrong. Please try again." };
  }
}

export async function importVoiceAssistantCalls(): Promise<ImportCallsResult> {
  const auth = await requireChurchAuth();

  const denied = await featureActionError("voice_assistant");
  if (denied) return { error: denied };

  if (!auth.isAdmin) {
    return { error: "Only church admins can import calls." };
  }

  try {
    const { imported } = await importRetellCallsForChurch(auth.churchId);
    revalidatePath("/dashboard/voice-assistant");
    revalidatePath("/dashboard/call-log");
    revalidatePath("/dashboard/call-log");
    revalidatePath("/dashboard");
    return { ok: true, imported };
  } catch (err) {
    console.error("[voice-assistant] import calls error", err);
    return {
      error:
        err instanceof Error
          ? err.message
          : "Could not import calls from Retell.",
    };
  }
}

export async function rescorePhoneCall(
  callId: string,
): Promise<RescoreCallResult> {
  const auth = await requireChurchAuth();

  const denied = await featureActionError("voice_assistant");
  if (denied) return { error: denied };

  if (!auth.isAdmin) {
    return { error: "Only church admins can re-score calls." };
  }

  const supabase = createClient();
  const call = await getPhoneCallById(auth.churchId, callId, supabase);
  if (!call) {
    return { error: "Call not found." };
  }
  if (!call.transcript?.trim()) {
    return { error: "This call has no transcript to score." };
  }

  try {
    const result = await scorePhoneCallIfNeeded(callId, { force: true });
    revalidatePath(`/dashboard/call-log/${callId}`);
    revalidatePath("/dashboard/call-log");
    revalidatePath(`/dashboard/call-log/${callId}`);
    revalidatePath("/dashboard/call-log");
    revalidatePath("/dashboard/voice-assistant");
    return { ok: true, score: result?.score ?? null };
  } catch (err) {
    console.error("[voice-assistant] re-score error", err);
    return {
      error:
        err instanceof Error ? err.message : "Could not re-score this call.",
    };
  }
}

export type RescoreLegacyCallsResult =
  | { ok: true; rescored: number; failed: number; remaining: number }
  | { error: string };

/**
 * How many older calls one round judges. Each is a model call of a few
 * seconds; five in parallel keeps a round well inside the action's time
 * budget, and the button keeps asking for another round until none are left.
 */
const LEGACY_RESCORE_BATCH = 5;

/**
 * Judge one round of calls the retired rubric scored, under the current one.
 *
 * Migration 0070 converted their numbers but could not invent the kind of call
 * each was, or whether anyone still needs to ring back, because the old rubric
 * never asked. Until they are re-scored the log shows a converted rank with no
 * kind and the old reasoning beside it, which reads as wrong because it is.
 */
export async function rescoreLegacyPhoneCalls(): Promise<RescoreLegacyCallsResult> {
  const auth = await requireChurchAuth();

  const denied = await featureActionError("voice_assistant");
  if (denied) return { error: denied };

  if (!auth.isAdmin) {
    return { error: "Only church admins can re-score calls." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("phone_calls")
    .select("id, score_breakdown")
    .eq("church_id", auth.churchId)
    .not("scored_at", "is", null)
    .order("called_at", { ascending: false });

  if (error) {
    console.error("[voice-assistant] legacy re-score lookup failed", error);
    return { error: "Could not load the older calls." };
  }

  const legacy = (data ?? []).filter((row) => {
    const version = (row.score_breakdown as { version?: unknown } | null)
      ?.version;
    return typeof version !== "number" || version < PHONE_CALL_SCORING_VERSION;
  });

  const batch = legacy.slice(0, LEGACY_RESCORE_BATCH);
  const results = await Promise.allSettled(
    batch.map((row) =>
      scorePhoneCallIfNeeded(row.id as string, { force: true, admin }),
    ),
  );
  const rescored = results.filter(
    (result) => result.status === "fulfilled" && result.value != null,
  ).length;

  if (rescored > 0) {
    revalidatePath("/dashboard/call-log");
    revalidatePath("/dashboard/voice-assistant");
    revalidatePath("/dashboard");
  }

  return {
    ok: true,
    rescored,
    failed: batch.length - rescored,
    remaining: legacy.length - rescored,
  };
}

export async function provisionVoicePhoneNumber(input?: {
  areaCode?: string;
}): Promise<ProvisionPhoneResult> {
  const auth = await requireChurchAuth();

  const denied = await featureActionError("voice_assistant");
  if (denied) return { error: denied };

  if (!auth.isAdmin) {
    return { error: "Only church admins can set up a phone number." };
  }

  const raw = input?.areaCode?.trim() ?? "";
  let areaCode: number | undefined;
  if (raw) {
    if (!/^\d{3}$/.test(raw)) {
      return { error: "Area code must be 3 digits (e.g. 615)." };
    }
    areaCode = Number(raw);
  }

  try {
    const result = await provisionRetellPhoneForChurch(auth.churchId, {
      areaCode,
    });
    revalidatePath("/dashboard/voice-assistant");
    revalidatePath("/dashboard");
    return {
      ok: true,
      phoneNumber: result.phoneNumber,
      created: result.created,
    };
  } catch (err) {
    console.error("[voice-assistant] provision phone error", err);
    return {
      error:
        err instanceof Error
          ? err.message
          : "Could not set up a phone number.",
    };
  }
}

export async function syncVoicePhoneNumber(): Promise<SyncPhoneResult> {
  const auth = await requireChurchAuth();

  const denied = await featureActionError("voice_assistant");
  if (denied) return { error: denied };

  if (!auth.isAdmin) {
    return { error: "Only church admins can sync phone numbers." };
  }

  try {
    const phoneNumber = await syncRetellPhoneForChurch(auth.churchId);
    revalidatePath("/dashboard/voice-assistant");
    revalidatePath("/dashboard");
    return { ok: true, phoneNumber };
  } catch (err) {
    console.error("[voice-assistant] sync phone error", err);
    return {
      error:
        err instanceof Error
          ? err.message
          : "Could not sync the phone number from Retell.",
    };
  }
}
