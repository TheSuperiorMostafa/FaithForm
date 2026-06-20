import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isPlacidConfigured,
  renderSocialGraphic,
  resolvePlacidTemplateUuidFromEnv,
} from "@/lib/integrations/placid";
import { generateAnnouncementGraphic } from "@/lib/integrations/announcement-graphic";
import { pickBackgroundImage } from "@/lib/social/background-images";
import {
  SOCIAL_GRAPHICS_BUCKET,
  type SocialTemplateKey,
} from "@/lib/social/constants";
import { createAdminClient } from "@/lib/supabase/admin";

export type ChurchBranding = {
  name: string;
  logoUrl: string | null;
  primaryColor: string;
  accentColor: string;
};

export type SocialPreviewInput = {
  churchId: string;
  title: string;
  when: string;
  location: string;
  headline: string;
  templateKey: SocialTemplateKey;
  backgroundTag: string;
  draftKey: string;
};

export type SocialPreviewGraphic = {
  graphicUrl: string;
  graphicPath: string;
  usedPlacid: boolean;
  warning?: string;
};

export async function resolveSocialTemplateUuid(
  supabase: SupabaseClient,
  templateKey: SocialTemplateKey,
): Promise<string | null> {
  const { data } = await supabase
    .from("social_templates")
    .select("placid_template_uuid")
    .eq("key", templateKey)
    .eq("active", true)
    .maybeSingle();

  const fromDb = (data?.placid_template_uuid as string | undefined)?.trim();
  if (fromDb) return fromDb;

  return resolvePlacidTemplateUuidFromEnv(templateKey);
}

export async function loadChurchBranding(
  supabase: SupabaseClient,
  churchId: string,
): Promise<ChurchBranding> {
  const { data } = await supabase
    .from("churches")
    .select("name, logo_url, giving_primary_color, giving_accent_color")
    .eq("id", churchId)
    .maybeSingle();

  return {
    name: (data?.name as string) ?? "Our Church",
    logoUrl: (data?.logo_url as string | null) ?? null,
    primaryColor: (data?.giving_primary_color as string) || "#1e3a5f",
    accentColor: (data?.giving_accent_color as string) || "#c9a227",
  };
}

function buildPlacidLayers(
  branding: ChurchBranding,
  input: SocialPreviewInput,
  backgroundUrl: string | null,
): Record<string, { text?: string; image?: string; color?: string; hide?: boolean }> {
  const layers: Record<
    string,
    { text?: string; image?: string; color?: string; hide?: boolean }
  > = {
    title: { text: input.title },
    headline: { text: input.headline },
    when: { text: input.when },
    location: {
      text: input.location.trim() || "See announcement for details",
    },
    primary_color: { color: branding.primaryColor },
    accent_color: { color: branding.accentColor },
  };

  if (backgroundUrl) {
    layers.background = { image: backgroundUrl };
  }

  if (branding.logoUrl) {
    layers.church_logo = { image: branding.logoUrl };
  } else {
    layers.church_logo = { hide: true };
  }

  return layers;
}

async function uploadSocialGraphic(
  churchId: string,
  draftKey: string,
  imageBytes: ArrayBuffer,
): Promise<{ graphicUrl: string; graphicPath: string }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured");
  }

  const admin = createAdminClient();
  const graphicPath = `${churchId}/${draftKey}.png`;

  const { error } = await admin.storage
    .from(SOCIAL_GRAPHICS_BUCKET)
    .upload(graphicPath, imageBytes, {
      contentType: "image/png",
      upsert: true,
    });

  if (error) {
    throw new Error(`Failed to store social graphic: ${error.message}`);
  }

  const graphicUrl = `${supabaseUrl}/storage/v1/object/public/${SOCIAL_GRAPHICS_BUCKET}/${graphicPath}`;

  return { graphicUrl, graphicPath };
}

export async function generateSocialGraphic(
  supabase: SupabaseClient,
  branding: ChurchBranding,
  input: SocialPreviewInput,
): Promise<SocialPreviewGraphic> {
  const background = await pickBackgroundImage(
    supabase,
    input.backgroundTag as Parameters<typeof pickBackgroundImage>[1],
  );

  const templateUuid = await resolveSocialTemplateUuid(supabase, input.templateKey);

  if (isPlacidConfigured() && templateUuid) {
    try {
      const layers = buildPlacidLayers(
        branding,
        input,
        background?.publicUrl ?? null,
      );
      const placidResult = await renderSocialGraphic({
        templateUuid,
        layers,
      });

      const stored = await uploadSocialGraphic(
        input.churchId,
        input.draftKey,
        placidResult.imageBytes,
      );

      return {
        ...stored,
        usedPlacid: true,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Placid render failed";
      const fallback = await generateFallbackGraphic(
        supabase,
        branding,
        input,
        message,
      );
      return fallback;
    }
  }

  return generateFallbackGraphic(
    supabase,
    branding,
    input,
    !isPlacidConfigured()
      ? "Placid is not configured — using default graphic"
      : "No Placid template configured — using default graphic",
  );
}

async function generateFallbackGraphic(
  supabase: SupabaseClient,
  branding: ChurchBranding,
  input: SocialPreviewInput,
  warning: string,
): Promise<SocialPreviewGraphic> {
  const imageBytes = await generateAnnouncementGraphic({
    churchName: branding.name,
    title: input.headline || input.title,
    when: input.when,
    location: input.location,
  });

  const stored = await uploadSocialGraphic(
    input.churchId,
    input.draftKey,
    imageBytes,
  );

  return {
    ...stored,
    usedPlacid: false,
    warning,
  };
}

export async function downloadSocialGraphic(
  graphicPath: string,
): Promise<ArrayBuffer> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(SOCIAL_GRAPHICS_BUCKET)
    .download(graphicPath);

  if (error || !data) {
    throw new Error(error?.message ?? "Social graphic not found");
  }

  return data.arrayBuffer();
}
