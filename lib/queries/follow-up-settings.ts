import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_FOLLOW_UP_TEMPLATES,
  normalizeFollowUpTemplates,
  parseFollowUpTemplatesFromDb,
} from "@/lib/sms/follow-up-messages";
import { createClient } from "@/lib/supabase/server";

export async function getFollowUpMessageTemplates(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<string[]> {
  const client = supabase ?? createClient();
  const { data, error } = await client
    .from("church_settings")
    .select("attendance_follow_up_messages")
    .eq("church_id", churchId)
    .maybeSingle();

  if (error) {
    console.error("getFollowUpMessageTemplates:", error.message);
    return [...DEFAULT_FOLLOW_UP_TEMPLATES];
  }

  const parsed = parseFollowUpTemplatesFromDb(
    data?.attendance_follow_up_messages,
  );
  return parsed ?? [...DEFAULT_FOLLOW_UP_TEMPLATES];
}

export async function upsertFollowUpMessageTemplates(
  churchId: string,
  templates: string[],
  supabase?: SupabaseClient,
) {
  const client = supabase ?? createClient();
  const normalized = normalizeFollowUpTemplates(templates);

  const { data, error } = await client
    .from("church_settings")
    .upsert(
      {
        church_id: churchId,
        attendance_follow_up_messages: normalized,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "church_id" },
    )
    .select("attendance_follow_up_messages")
    .single();

  if (error) throw error;
  return parseFollowUpTemplatesFromDb(data.attendance_follow_up_messages) ??
    normalized;
}
