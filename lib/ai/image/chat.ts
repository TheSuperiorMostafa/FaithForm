import "server-only";

import sharp from "sharp";

import {
  buildImageChatContents,
  IMAGE_CHAT_OUTPUT_MAX_EDGE,
  IMAGE_CHAT_SYSTEM_INSTRUCTION,
  type ImageChatRequest,
} from "@/lib/ai/image/chat-prompt";
import { generateGeminiChatImage, isGeminiImageConfigured } from "@/lib/ai/image/gemini";
import { UserFacingError } from "@/lib/errors/user-error";

export type ImageChatTurnResult = {
  image: { mimeType: "image/jpeg"; data: string; width: number; height: number };
  note: string | null;
};

/** The chat uses Gemini's image editing, so it is offered only with Gemini set up. */
export function isImageChatConfigured(): boolean {
  return isGeminiImageConfigured();
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
 * One turn of the image chat. The result is re-encoded as a JPEG no larger
 * than IMAGE_CHAT_OUTPUT_MAX_EDGE so it can travel back to the browser and,
 * on the next turn, back here for editing without nearing the body limit.
 */
export async function runImageChatTurn(request: ImageChatRequest): Promise<ImageChatTurnResult> {
  let generated;
  try {
    generated = await generateGeminiChatImage({
      contents: buildImageChatContents(request),
      systemInstruction: IMAGE_CHAT_SYSTEM_INSTRUCTION,
    });
  } catch (err) {
    throw friendlyProviderError(err);
  }

  const { data, info } = await sharp(generated.imageBytes)
    .rotate()
    .resize({
      width: IMAGE_CHAT_OUTPUT_MAX_EDGE,
      height: IMAGE_CHAT_OUTPUT_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 85, mozjpeg: true })
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
