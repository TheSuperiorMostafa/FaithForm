import {
  AUTOMATION_CATALOG,
  type AutomationType,
  getCatalogMinutes,
} from "@/lib/automation-catalog";
import { createAdminClientOrNull } from "@/lib/supabase/admin";

export type LogActivityInput = {
  churchId: string;
  automationType: string;
  category?: string;
  taskName: string;
  timeSavedMinutes?: number;
  triggerSource: string;
  executedAt?: string;
};

export async function logPhoneCallActivity(input: {
  churchId: string;
  phoneCallId: string;
  retailAiCallId: string;
  callerNumber: string | null;
  durationSeconds: number | null;
  executedAt: string;
  timeSavedMinutes: number;
}): Promise<void> {
  const triggerSource = `phone_call:${input.retailAiCallId}`;

  try {
    const admin = createAdminClientOrNull();
    if (!admin) return;

    const { data: existing } = await admin
      .from("activity_log")
      .select("id")
      .eq("trigger_source", triggerSource)
      .maybeSingle();

    if (existing?.id) return;

    await logActivity({
      churchId: input.churchId,
      automationType: "Phone Call + Duration of Call",
      category: "Phone",
      taskName: input.callerNumber
        ? `AI answered call from ${input.callerNumber}`
        : "AI answered phone call",
      timeSavedMinutes: input.timeSavedMinutes,
      triggerSource,
      executedAt: input.executedAt,
    });
  } catch (activityError) {
    console.error("phone call activity_log failed:", activityError);
  }
}

export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    const admin = createAdminClientOrNull();
    if (!admin) return;

    const { data: existing } = await admin
      .from("activity_log")
      .select("id")
      .eq("trigger_source", input.triggerSource)
      .maybeSingle();

    if (existing?.id) return;

    const catalog = AUTOMATION_CATALOG[input.automationType as AutomationType];
    const timeSavedMinutes =
      input.timeSavedMinutes ??
      catalog?.minutes ??
      getCatalogMinutes(input.automationType);

    const row: Record<string, unknown> = {
      church_id: input.churchId,
      automation_type: input.automationType,
      category: input.category ?? catalog?.category ?? "Admin",
      task_name: input.taskName,
      time_saved_minutes: timeSavedMinutes,
      trigger_source: input.triggerSource,
    };

    if (input.executedAt) {
      row.executed_at = input.executedAt;
    }

    const { error } = await admin.from("activity_log").insert(row);
    if (error) {
      console.error("activity_log insert failed:", error.message);
    }
  } catch (activityError) {
    console.error("activity_log insert failed:", activityError);
  }
}
