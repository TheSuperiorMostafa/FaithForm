import type { SupabaseClient } from "@supabase/supabase-js";

import { aiGenerateObject } from "@/lib/ai";
import { eventSocialSystemPrompt } from "@/lib/ai/prompts";
import { eventSocialPreviewSchema } from "@/lib/ai/schemas";
import { formatDateTimeRange } from "@/lib/queries/announcements";
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
  usedPlacid: boolean;
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
  const when = formatDateTimeRange(input.startAt, input.endAt);

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

  const graphic = await generateSocialGraphic(supabase, branding, {
    churchId: input.churchId,
    title: input.title,
    when,
    location: input.location,
    headline: object.headline,
    templateKey: object.templateKey,
    backgroundTag: object.backgroundTag,
    draftKey,
  });

  return {
    headline: object.headline,
    facebookCaption: object.facebookCaption,
    backgroundTag: object.backgroundTag,
    templateKey: object.templateKey,
    graphicUrl: graphic.graphicUrl,
    graphicPath: graphic.graphicPath,
    usedPlacid: graphic.usedPlacid,
    warning: graphic.warning,
    modelUsed,
  };
}
