import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logActivity } from "@/lib/activity/log";

/**
 * Time-saved credits shared by more than one route. Minutes come from the
 * automation catalog; each trigger source says what one credit stands for, so
 * repeats of the same thing are not counted twice.
 */

/** "Update Church Calendar": once per calendar event FaithForm creates or changes. */
export async function logCalendarUpdated(churchId: string, eventId: string, title: string) {
  await logActivity({
    churchId,
    automationType: "Update Church Calendar",
    taskName: title,
    triggerSource: `calendar_event:${eventId}`,
  });
}

/**
 * "Image Generation": once per new picture. Refining the same picture in the
 * image chat, or regenerating the same announcement's graphic, is not a new one.
 * Without a `key`, every call is its own picture.
 */
export async function logImageGenerated(
  churchId: string,
  source: "chat" | "announcement" | "media",
  title: string,
  key?: string,
) {
  await logActivity({
    churchId,
    automationType: "Image Generation",
    taskName: title,
    triggerSource: `image:${source}:${key ?? randomUUID()}`,
  });
}

/**
 * Announcement credits, one per channel per announcement, so each shows in
 * Activity. The trigger sources match the backfill in migration 0177.
 */
export const ANNOUNCEMENT_CREDITS = {
  publish: { type: "Publish Announcement", prefix: "announcement_publish" },
  app: { type: "Church App Updated", prefix: "announcement_app" },
  facebook: { type: "Facebook Post about Announcement", prefix: "announcement_facebook" },
  email: { type: "Announcement Email", prefix: "announcement_email" },
} as const;

export type AnnouncementChannel = keyof typeof ANNOUNCEMENT_CREDITS;

export async function logAnnouncementCredit(
  channel: AnnouncementChannel,
  churchId: string,
  announcementId: string,
  title: string,
  client?: SupabaseClient,
) {
  const credit = ANNOUNCEMENT_CREDITS[channel];
  await logActivity({
    churchId,
    automationType: credit.type,
    taskName: title,
    triggerSource: `${credit.prefix}:${announcementId}`,
  }, client);
}

/**
 * Credits one press of "Send X messages" on the follow-up page:
 * "Personalized Pastoral Follow-up" once per send, plus a missed-Sundays credit
 * per person texted (2-3 Sundays in a row: the 2-week credit; 4 or more: the
 * 4-week credit). Each text also earns "Attendance Follow-up Text" once its
 * delivery is confirmed (database trigger, migrations 0136 and 0177).
 */
export async function logFollowUpSendCredits(
  input: {
    churchId: string;
    serviceDate: string;
    sent: number;
    texted: { entryId: string; consecutiveAbsent: number }[];
  },
  client?: SupabaseClient,
) {
  if (input.sent > 0) {
    await logActivity({
      churchId: input.churchId,
      automationType: "Personalized Pastoral Follow-up",
      taskName: `Follow-up texts sent for ${input.serviceDate} (${input.sent})`,
      triggerSource: `pastoral_follow_up:${input.serviceDate}:${randomUUID()}`,
    }, client);
  }
  for (const person of input.texted) {
    if (person.consecutiveAbsent < 2) continue;
    const fourPlus = person.consecutiveAbsent >= 4;
    await logActivity({
      churchId: input.churchId,
      automationType: fourPlus
        ? "Missed 4 weeks in a row notification"
        : "Missed 2 weeks in a row notification",
      taskName: `Follow-up for ${input.serviceDate}: missed ${person.consecutiveAbsent} Sundays in a row`,
      triggerSource: `${fourPlus ? "missed_4_weeks" : "missed_2_weeks"}:${person.entryId}`,
    }, client);
  }
}
