"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireChurchAuth } from "@/lib/auth/church";
import { importRetellCallsForChurch } from "@/lib/integrations/retell-calls";
import { syncRetellAgent } from "@/lib/integrations/retell";
import { upsertVoiceAssistantSettings } from "@/lib/queries/voice-assistant";
import {
  SPEAKING_PACES,
  VOICE_TONES,
  type OfficeHours,
} from "@/types/voice-assistant";

const dayHoursSchema = z.object({
  enabled: z.boolean(),
  open: z.string(),
  close: z.string(),
});

const officeHoursSchema = z.object({
  mon: dayHoursSchema,
  tue: dayHoursSchema,
  wed: dayHoursSchema,
  thu: dayHoursSchema,
  fri: dayHoursSchema,
  sat: dayHoursSchema,
  sun: dayHoursSchema,
});

const saveSchema = z.object({
  assistantName: z.string().max(80),
  denomination: z.string().max(80),
  churchPhone: z.string().max(30),
  emergencyPhone: z.string().max(30),
  tone: z.enum(VOICE_TONES),
  speakingPace: z.enum(SPEAKING_PACES),
  language: z.string().max(10),
  greetingMessage: z.string().max(2000),
  signoffMessage: z.string().max(1000),
  officeHours: officeHoursSchema,
  afterHoursEnabled: z.boolean(),
  afterHoursMessage: z.string().max(2000),
});

export type SaveVoiceAssistantResult =
  | { ok: true; agentId?: string }
  | { error: string };

export type ImportCallsResult =
  | { ok: true; imported: number }
  | { error: string };

export async function saveVoiceAssistantSettings(
  input: z.infer<typeof saveSchema>,
): Promise<SaveVoiceAssistantResult> {
  const auth = await requireChurchAuth();
  if (!auth.isAdmin) {
    return { error: "Only church admins can update voice assistant settings." };
  }

  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Please check your settings and try again." };
  }

  try {
    await upsertVoiceAssistantSettings(auth.churchId, {
      ...parsed.data,
      officeHours: parsed.data.officeHours as OfficeHours,
    });

    let agentId: string | undefined;
    try {
      const sync = await syncRetellAgent(auth.churchId);
      agentId = sync?.agentId;
    } catch (err) {
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
  if (!auth.isAdmin) {
    return { error: "Only church admins can import calls." };
  }

  try {
    const { imported } = await importRetellCallsForChurch(auth.churchId);
    revalidatePath("/dashboard/voice-assistant");
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
