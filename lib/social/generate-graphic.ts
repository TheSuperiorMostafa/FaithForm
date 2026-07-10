import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";

import {
  generateEventBackgroundImage,
  isAiImageConfigured,
} from "@/lib/ai/image";
import { formatEventGraphicDetails } from "@/lib/queries/announcements";
import { pickBackgroundImage } from "@/lib/social/background-images";
import { generateCinematicPlaceholderBackground } from "@/lib/social/cinematic-placeholder";
import {
  SOCIAL_GRAPHICS_BUCKET,
  type SocialBackgroundTag,
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
  startAt?: string;
  endAt?: string | null;
};

export type SocialPreviewGraphic = {
  graphicUrl: string;
  graphicPath: string;
  usedAiImage: boolean;
  imageModelUsed?: string;
  warning?: string;
};

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

async function fetchLogoForModel(
  logoUrl: string | null,
): Promise<{ bytes: ArrayBuffer; mimeType: string } | null> {
  if (!logoUrl) return null;
  try {
    const res = await fetch(logoUrl);
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();
    const mimeType =
      res.headers.get("content-type")?.split(";")[0] || "image/png";
    return { bytes, mimeType };
  } catch {
    return null;
  }
}

/** Normalize any provider image into a Facebook-ready 1200x630 PNG. */
async function normalizePng(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const png = await sharp(Buffer.from(bytes))
    .resize(1200, 630, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();
  return png.buffer.slice(
    png.byteOffset,
    png.byteOffset + png.byteLength,
  ) as ArrayBuffer;
}

/**
 * Fully AI-generated flyer: the model renders the entire design (title, date,
 * time, location) baked into the image, with the real church logo composited in.
 */
async function generateAiFlyer(
  branding: ChurchBranding,
  input: SocialPreviewInput,
): Promise<{ imageBytes: ArrayBuffer; modelUsed: string } | null> {
  if (!isAiImageConfigured()) return null;

  const { dateLine, timeLine } = input.startAt
    ? formatEventGraphicDetails(input.startAt, input.endAt ?? null)
    : { dateLine: input.when, timeLine: "" };

  const logo = await fetchLogoForModel(branding.logoUrl);

  try {
    const { imageBytes, modelUsed } = await generateEventBackgroundImage({
      title: input.title,
      headline: input.headline,
      backgroundTag: input.backgroundTag as SocialBackgroundTag,
      churchName: branding.name,
      primaryColor: branding.primaryColor,
      accentColor: branding.accentColor,
      location: input.location,
      mode: "flyer",
      dateLine,
      timeLine,
      logo,
    });

    return { imageBytes: await normalizePng(imageBytes), modelUsed };
  } catch {
    return null;
  }
}

/** Photo-only fallback when AI is unavailable: stock photo, else placeholder. */
async function generatePhotoFallback(
  supabase: SupabaseClient,
  branding: ChurchBranding,
  input: SocialPreviewInput,
): Promise<ArrayBuffer> {
  try {
    const stock = await pickBackgroundImage(
      supabase,
      input.backgroundTag as SocialBackgroundTag,
    );
    if (stock?.publicUrl) {
      const res = await fetch(stock.publicUrl);
      if (res.ok) {
        return normalizePng(await res.arrayBuffer());
      }
    }
  } catch {
    // fall through to placeholder
  }

  const placeholder = await generateCinematicPlaceholderBackground(
    branding.primaryColor,
    branding.accentColor,
  );
  return normalizePng(placeholder);
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
      // Short TTL so regenerated graphics are not served stale from the CDN.
      cacheControl: "60",
    });

  if (error) {
    throw new Error(`Failed to store social graphic: ${error.message}`);
  }

  // Cache-bust the display URL. The path is reused (upsert overwrites in place),
  // so without a unique query param the browser keeps showing the previous PNG.
  const version = Date.now().toString(36);
  const graphicUrl = `${supabaseUrl}/storage/v1/object/public/${SOCIAL_GRAPHICS_BUCKET}/${graphicPath}?v=${version}`;

  return { graphicUrl, graphicPath };
}

/**
 * Generate a fully AI-generated cinematic announcement flyer. Falls back to a
 * plain cinematic photo (no text) only if AI image generation is unavailable.
 */
export async function generateSocialGraphic(
  supabase: SupabaseClient,
  branding: ChurchBranding,
  input: SocialPreviewInput,
): Promise<SocialPreviewGraphic> {
  const flyer = await generateAiFlyer(branding, input);
  if (flyer) {
    const stored = await uploadSocialGraphic(
      input.churchId,
      input.draftKey,
      flyer.imageBytes,
    );
    return {
      ...stored,
      usedAiImage: true,
      imageModelUsed: flyer.modelUsed,
    };
  }

  const photoBytes = await generatePhotoFallback(supabase, branding, input);
  const stored = await uploadSocialGraphic(
    input.churchId,
    input.draftKey,
    photoBytes,
  );
  return {
    ...stored,
    usedAiImage: false,
    warning:
      "AI flyer generation is unavailable — used a cinematic photo. Set GEMINI_API_KEY to enable full flyers.",
  };
}

/** Last-resort graphic for publish when no stored preview exists. */
export async function generateEmergencySocialGraphic(
  supabase: SupabaseClient,
  churchId: string,
  input: {
    title: string;
    headline?: string;
    when: string;
    location: string;
    startAt?: string;
    endAt?: string | null;
    backgroundTag?: string;
  },
): Promise<ArrayBuffer> {
  const branding = await loadChurchBranding(supabase, churchId);
  const previewInput: SocialPreviewInput = {
    churchId,
    title: input.title,
    when: input.when,
    location: input.location,
    headline: input.headline ?? input.title,
    templateKey: "general",
    backgroundTag: input.backgroundTag ?? "default",
    draftKey: `emergency-${Date.now()}`,
    startAt: input.startAt,
    endAt: input.endAt,
  };

  const flyer = await generateAiFlyer(branding, previewInput);
  if (flyer) return flyer.imageBytes;

  return generatePhotoFallback(supabase, branding, previewInput);
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
