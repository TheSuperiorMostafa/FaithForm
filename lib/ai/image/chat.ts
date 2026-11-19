import "server-only";

import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildImageChatContents,
  IMAGE_CHAT_MODEL_ASPECT_RATIO,
  IMAGE_CHAT_OUTPUT_HEIGHT,
  IMAGE_CHAT_OUTPUT_WIDTH,
  IMAGE_CHAT_SYSTEM_INSTRUCTION,
  type ImageChatBrand,
  type ImageChatRequest,
} from "@/lib/ai/image/chat-prompt";
import { generateGeminiChatImage, isGeminiImageConfigured } from "@/lib/ai/image/gemini";
import { UserFacingError } from "@/lib/errors/user-error";
import { fetchLogoForModel, loadChurchBranding } from "@/lib/social/generate-graphic";

export type ImageChatTurnResult = {
  image: { mimeType: "image/jpeg"; data: string; width: number; height: number };
  note: string | null;
};

/** The studio uses Gemini's image editing, so it is offered only with Gemini set up. */
export function isImageChatConfigured(): boolean {
  return isGeminiImageConfigured();
}

/** Longest edge of the logo handed to the model: plenty to copy it faithfully. */
const LOGO_MAX_EDGE = 512;

/**
 * The church's name, colours and logo. The logo is re-encoded as a small PNG
 * so SVG or oversized uploads still reach the model; a logo that can't be read
 * is left off rather than failing the picture.
 */
export async function loadImageChatBrand(
  supabase: SupabaseClient,
  churchId: string,
): Promise<ImageChatBrand> {
  const branding = await loadChurchBranding(supabase, churchId);
  let logo: ImageChatBrand["logo"] = null;
  const fetched = await fetchLogoForModel(branding.logoUrl);
  if (fetched) {
    try {
      const png = await sharp(Buffer.from(fetched.bytes))
        .resize({ width: LOGO_MAX_EDGE, height: LOGO_MAX_EDGE, fit: "inside", withoutEnlargement: true })
        .png()
        .toBuffer();
      logo = { mimeType: "image/png", data: png.toString("base64") };
    } catch (err) {
      console.warn("[ai-image-chat] church logo could not be read:", err instanceof Error ? err.message : err);
    }
  }
  return {
    churchName: branding.name,
    primaryColor: branding.primaryColor,
    accentColor: branding.accentColor,
    logo,
  };
}

/**
 * Turns a provider failure into something a church can act on, or leaves it
 * for toUserError's generic message.
 */
function friendlyProviderError(error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.startsWith("gemini returned no image")) {
    return new UserFacingError(
      lower.includes("safety") || lower.includes("prohibited") || lower.includes("block")
        ? "We couldn't make that picture. Try describing it a different way, without people in it."
        : "We couldn't make a picture from that. Try describing it a different way.",
    );
  }
  if (lower.includes("429") || lower.includes("resource_exhausted") || lower.includes("quota")) {
    return new UserFacingError("The picture maker is busy right now. Wait a minute and try again.");
  }
  return error;
}

/**
 * One turn of the studio. The result is trimmed to the 1200×630 event graphic
 * and re-encoded as a JPEG, small enough to travel back to the browser and, on
 * the next turn, back here for editing without nearing the body limit.
 */
export async function runImageChatTurn(
  request: ImageChatRequest,
  brand: ImageChatBrand | null,
): Promise<ImageChatTurnResult> {
  let generated;
  try {
    generated = await generateGeminiChatImage({
      contents: buildImageChatContents(request, brand),
      systemInstruction: IMAGE_CHAT_SYSTEM_INSTRUCTION,
      aspectRatio: IMAGE_CHAT_MODEL_ASPECT_RATIO,
    });
  } catch (err) {
    throw friendlyProviderError(err);
  }

  const { data, info } = await sharp(generated.imageBytes)
    .rotate()
    .resize(IMAGE_CHAT_OUTPUT_WIDTH, IMAGE_CHAT_OUTPUT_HEIGHT, { fit: "cover", position: "centre" })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  return {
    image: {
      mimeType: "image/jpeg",
      data: data.toString("base64"),
      width: info.width,
      height: info.height,
    },
    note: generated.text,
  };
}
