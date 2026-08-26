import type { SupabaseClient } from "@supabase/supabase-js";

import { aiGenerateObject } from "@/lib/ai";
import { eventSocialSystemPrompt } from "@/lib/ai/prompts";
import { eventSocialPreviewSchema } from "@/lib/ai/schemas";
import { formatDateTimeRange } from "@/lib/queries/announcements";
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

export async function generateSocialPreview(
  supabase: SupabaseClient,
  input: GenerateSocialPreviewInput,
): Promise<SocialPreviewResult> {
  const branding = await loadChurchBranding(supabase, input.churchId);
  // The church's zone, not the server's: this runs on Vercel in UTC, where an
  // 8pm Eastern event would otherwise read as the next day in the caption.
  const when = formatDateTimeRange(input.startAt, input.endAt, branding.timezone);

  const { object, modelUsed } = await aiGenerateObject({
    churchId: input.churchId,
    system: eventSocialSystemPrompt({
      churchName: branding.name,
      title: input.title,
      when,
      location: input.location,
      notes: input.notes,
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
    draftKey,
    startAt: input.startAt,
    endAt: input.endAt,
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
