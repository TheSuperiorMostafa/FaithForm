"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireChurchAuth } from "@/lib/auth/church";
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

export type SaveVoiceAssistantResult = { ok: true } | { error: string };

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

    try {
      await syncRetellAgent(auth.churchId);
    } catch (err) {
      console.error("[voice-assistant] Retell sync error", err);
    }

    revalidatePath("/dashboard/voice-assistant");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch {
    return { error: "Something went wrong. Please try again." };
  }
}
