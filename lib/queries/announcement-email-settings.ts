import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_ANNOUNCEMENT_EMAIL_BODY,
  DEFAULT_ANNOUNCEMENT_EMAIL_SUBJECT,
  normalizeAnnouncementEmailTemplate,
  type AnnouncementEmailTemplate,
} from "@/lib/email/announcement-template";
import { createClient } from "@/lib/supabase/server";

type ChurchSettingsRow = {
  announcement_email_subject: string | null;
  announcement_email_body: string | null;
  announcement_email_to: string | null;
  announcement_weekly_email_enabled: boolean | null;
  last_weekly_announcement_draft_week_start: string | null;
  last_weekly_announcement_draft_id: string | null;
};

function mapRow(row: ChurchSettingsRow | null): AnnouncementEmailTemplate & {
  lastWeeklyDraftWeekStart: string | null;
  lastWeeklyDraftId: string | null;
} {
  const template = normalizeAnnouncementEmailTemplate({
    subject: row?.announcement_email_subject ?? DEFAULT_ANNOUNCEMENT_EMAIL_SUBJECT,
    body: row?.announcement_email_body ?? DEFAULT_ANNOUNCEMENT_EMAIL_BODY,
    to: row?.announcement_email_to ?? null,
    weeklyEmailEnabled: row?.announcement_weekly_email_enabled ?? true,
  });

  return {
    ...template,
    lastWeeklyDraftWeekStart:
      row?.last_weekly_announcement_draft_week_start ?? null,
    lastWeeklyDraftId: row?.last_weekly_announcement_draft_id ?? null,
  };
}

export async function getAnnouncementEmailSettings(
  churchId: string,
  supabase?: SupabaseClient,
) {
  const client = supabase ?? createClient();
  const { data, error } = await client
    .from("church_settings")
    .select(
      "announcement_email_subject, announcement_email_body, announcement_email_to, announcement_weekly_email_enabled, last_weekly_announcement_draft_week_start, last_weekly_announcement_draft_id",
    )
    .eq("church_id", churchId)
    .maybeSingle();

  if (error) {
    console.error("getAnnouncementEmailSettings:", error.message);
    return mapRow(null);
  }

  return mapRow((data as ChurchSettingsRow | null) ?? null);
}

export async function upsertAnnouncementEmailSettings(
  churchId: string,
  template: AnnouncementEmailTemplate,
  supabase?: SupabaseClient,
) {
  const client = supabase ?? createClient();
  const normalized = normalizeAnnouncementEmailTemplate(template);

  const { data, error } = await client
    .from("church_settings")
    .upsert(
      {
        church_id: churchId,
        announcement_email_subject: normalized.subject,
        announcement_email_body: normalized.body,
        announcement_email_to: normalized.to,
        announcement_weekly_email_enabled: normalized.weeklyEmailEnabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "church_id" },
    )
    .select(
      "announcement_email_subject, announcement_email_body, announcement_email_to, announcement_weekly_email_enabled, last_weekly_announcement_draft_week_start, last_weekly_announcement_draft_id",
    )
    .single();

  if (error) throw error;
  return mapRow(data as ChurchSettingsRow);
}

export async function markWeeklyAnnouncementDraftCreated(
  churchId: string,
  weekStartKey: string,
  draftId: string,
  supabase: SupabaseClient,
) {
  const { error } = await supabase
    .from("church_settings")
    .upsert(
      {
        church_id: churchId,
        last_weekly_announcement_draft_week_start: weekStartKey,
        last_weekly_announcement_draft_id: draftId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "church_id" },
    );

  if (error) throw error;
}
