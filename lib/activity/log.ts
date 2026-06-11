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

export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    const admin = createAdminClientOrNull();
    if (!admin) return;

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
