import type { SupabaseClient } from "@supabase/supabase-js";

import { aiGenerateObject } from "@/lib/ai";
import { eventSocialSystemPrompt } from "@/lib/ai/prompts";
import { eventSocialPreviewSchema } from "@/lib/ai/schemas";
import {
  formatDateTimeRange,
  formatEventWhenForPrompt,
} from "@/lib/queries/announcements";
import { resolveFlyerHeadline } from "@/lib/social/headline-display";
import {
  generateSocialGraphic,
  loadChurchBranding,
} from "@/lib/social/generate-graphic";

export type GenerateSocialPreviewInput = {
  churchId: string;
  title: string;
  location: string;
  startAt: string;
  endAt: string | null;
  allDay?: boolean;
  notes?: string;
  googleEventId?: string | null;
  announcementId?: string | null;
};

export type SocialPreviewResult = {
  headline: string;
  facebookCaption: string;
  backgroundTag: string;
  templateKey: string;
  graphicUrl: string;
  graphicPath: string;
  usedAiImage: boolean;
  warning?: string;
  modelUsed: string;
};

function buildDraftKey(input: GenerateSocialPreviewInput): string {
  if (input.announcementId) return `announcement-${input.announcementId}`;
  if (input.googleEventId) {
    return `draft-${input.googleEventId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  }
  return `draft-${Date.now()}`;
}

/**
 * The church's own people, most senior first, as "Name — Title" lines.
 *
 * Without this the caption writer had no idea who ran the church, so an event
 * called "Coffee with the Pastor" produced a caption inviting people to have
 * coffee with an abstraction. Ordered so the first line is the one an event
 * saying "the Pastor" almost certainly means.
 */
async function loadStaffLines(
  supabase: SupabaseClient,
  churchId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("church_staff")
    .select(
      "full_name, title, is_senior_pastor, is_executive_pastor, sort_order",
    )
    .eq("church_id", churchId);

  if (error) {
    // A caption without names still reads; a failed lookup must not stop the
    // preview being generated at all.
    console.error("loadStaffLines:", error.message);
    return [];
  }

  type StaffRow = {
    full_name: string | null;
    title: string | null;
    is_senior_pastor: boolean | null;
    is_executive_pastor: boolean | null;
    sort_order: number | null;
  };

  const rank = (row: StaffRow) =>
    row.is_senior_pastor ? 0 : row.is_executive_pastor ? 1 : 2;

  return ((data ?? []) as StaffRow[])
    .filter((row) => row.full_name?.trim())
    .sort(
      (a, b) => rank(a) - rank(b) || (a.sort_order ?? 0) - (b.sort_order ?? 0),
    )
    .slice(0, 8)
    .map((row) => {
      const name = row.full_name!.trim();
      const title = row.title?.trim();
      const senior = row.is_senior_pastor ? " (senior pastor)" : "";
      return title ? `${name} — ${title}${senior}` : `${name}${senior}`;
    });
}

export async function generateSocialPreview(
  supabase: SupabaseClient,
  input: GenerateSocialPreviewInput,
): Promise<SocialPreviewResult> {
  const [branding, staff] = await Promise.all([
    loadChurchBranding(supabase, input.churchId),
    loadStaffLines(supabase, input.churchId),
  ]);
  // The church's zone, not the server's: this runs on Vercel in UTC, where an
  // 8pm Eastern event would otherwise read as the next day in the caption.
  const when = formatDateTimeRange(
    input.startAt,
    input.endAt,
    branding.timezone,
    input.allDay,
  );
  // The model is told the weekday outright rather than left to work it out
  // from a bare "Aug 4", which it gets wrong whenever its calendar and the
  // church's disagree.
  const whenForPrompt = formatEventWhenForPrompt(
    input.startAt,
    input.endAt,
    branding.timezone,
    input.allDay,
  );

  const { object, modelUsed } = await aiGenerateObject({
    churchId: input.churchId,
    system: eventSocialSystemPrompt({
      churchName: branding.name,
      title: input.title,
      when: whenForPrompt,
      location: input.location,
      notes: input.notes,
      staff,
    }),
    prompt:
      "Write a Facebook caption and graphic headline for this church event. Return structured JSON only.",
    schema: eventSocialPreviewSchema,
    maxOutputTokens: 1024,
  });

  const draftKey = buildDraftKey(input);
  const flyerHeadline = resolveFlyerHeadline(input.title, object.headline);

  const graphic = await generateSocialGraphic(supabase, branding, {
    churchId: input.churchId,
    title: input.title,
    when,
    location: input.location,
    headline: flyerHeadline,
    templateKey: object.templateKey,
    backgroundTag: object.backgroundTag,
    imageSubject: object.imageSubject,
    draftKey,
    startAt: input.startAt,
    endAt: input.endAt,
    allDay: input.allDay,
    timeZone: branding.timezone,
  });

  return {
    headline: flyerHeadline,
    facebookCaption: object.facebookCaption,
    backgroundTag: object.backgroundTag,
    templateKey: object.templateKey,
    graphicUrl: graphic.graphicUrl,
    graphicPath: graphic.graphicPath,
    usedAiImage: graphic.usedAiImage,
    warning: graphic.warning,
    modelUsed,
  };
}
