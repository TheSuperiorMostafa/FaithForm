import { GoogleGenAI } from "@google/genai";
import type { GenerateContentResponse } from "@google/genai";

import {
  buildImagePrompt,
  type GeneratedBackground,
  type GenerateEventBackgroundInput,
} from "@/lib/ai/image/prompt";

// Nano Banana — Google's fast, low-latency image generation model.
const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";
const DEFAULT_TIMEOUT_MS = 45_000;

export function isGeminiImageConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

function resolveModel(): string {
  return process.env.GEMINI_IMAGE_MODEL?.trim() || DEFAULT_GEMINI_IMAGE_MODEL;
}

function resolveTimeoutMs(): number {
  const raw = Number(process.env.GEMINI_IMAGE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

function extractImageBytes(response: GenerateContentResponse): ArrayBuffer | null {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const base64 = part.inlineData?.data;
    if (base64) {
      const binary = Buffer.from(base64, "base64");
      return binary.buffer.slice(
        binary.byteOffset,
        binary.byteOffset + binary.byteLength,
      );
    }
  }
  return null;
}

function describeEmptyResponse(response: GenerateContentResponse): string {
  const finishReason = response.candidates?.[0]?.finishReason;
  const blockReason = response.promptFeedback?.blockReason;
  const details = [
    finishReason ? `finishReason=${finishReason}` : null,
    blockReason ? `blockReason=${blockReason}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return details
    ? `Gemini returned no image (${details})`
    : "Gemini returned no image data";
}

/**
 * Generate a background photo with Gemini 2.5 Flash Image (Nano Banana).
 *
 * Requests a 16:9 frame via `imageConfig.aspectRatio`. Some model revisions do
 * not accept `imageConfig`; if that specific argument is rejected we transparently
 * retry once without it so a config quirk never disables the fast path.
 */
export async function generateGeminiBackgroundImage(
  input: GenerateEventBackgroundInput,
): Promise<GeneratedBackground> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const model = resolveModel();
  const prompt = buildImagePrompt(input);
  const ai = new GoogleGenAI({ apiKey });
  const httpOptions = { timeout: resolveTimeoutMs() };

  // In flyer mode, hand the model the real church logo so it can composite the
  // actual brand mark into the design rather than inventing one.
  const contents: unknown =
    input.mode === "flyer" && input.logo
      ? [
          { text: prompt },
          {
            text: `Incorporate the provided logo image as the church's real logo — place it tastefully near the top with the church name. Do not alter, distort, or add text to the logo.`,
          },
          {
            inlineData: {
              mimeType: input.logo.mimeType,
              data: Buffer.from(input.logo.bytes).toString("base64"),
            },
          },
        ]
      : prompt;

  const attempts: Array<Record<string, unknown>> = [
    { imageConfig: { aspectRatio: "16:9" }, httpOptions },
    { httpOptions },
  ];

  let lastError: Error | null = null;

  for (const config of attempts) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: contents as Parameters<
          typeof ai.models.generateContent
        >[0]["contents"],
        config,
      });

      const imageBytes = extractImageBytes(response);
      if (imageBytes) {
        return { imageBytes, modelUsed: `gemini:${model}` };
      }
      lastError = new Error(describeEmptyResponse(response));
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const message = lastError.message.toLowerCase();
      const isConfigRejection =
        message.includes("imageconfig") ||
        message.includes("aspect") ||
        message.includes("invalid") ||
        message.includes("unknown field");
      // Only fall through to the no-imageConfig attempt for config rejections.
      if (!isConfigRejection) break;
    }
  }

  throw lastError ?? new Error("Could not generate Gemini event background");
}

export type GeminiChatImageResult = {
  imageBytes: Buffer;
  mimeType: string;
  /** The model's short note about what it made, if it wrote one. */
  text: string | null;
  modelUsed: string;
};

/**
 * One turn of the "Create image for me" studio: create an image, or edit the
 * one passed inline in `contents` (multi-turn image editing). The contents
 * and system instruction are built by lib/ai/image/chat-prompt.ts.
 */
/**
 * The studio's first-choice model: Nano Banana Pro, which sets type and follows
 * layout instructions far better than the fast model. GEMINI_IMAGE_CHAT_MODEL
 * overrides it; if the key can't use it, the studio falls back to the fast one.
 */
const DEFAULT_GEMINI_IMAGE_CHAT_MODEL = "gemini-3-pro-image-preview";

/** Room for the Pro model, inside the route's 120s limit. */
const DEFAULT_CHAT_TIMEOUT_MS = 100_000;

function resolveChatTimeoutMs(): number {
  const raw = Number(process.env.GEMINI_IMAGE_CHAT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CHAT_TIMEOUT_MS;
}

function resolveChatModels(): string[] {
  const preferred = process.env.GEMINI_IMAGE_CHAT_MODEL?.trim() || DEFAULT_GEMINI_IMAGE_CHAT_MODEL;
  return [...new Set([preferred, resolveModel()])];
}

/** The model isn't available to this key or this API version. */
function isModelUnavailable(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    message.includes("not_found") ||
    message.includes("not found") ||
    message.includes("is not supported") ||
    message.includes("permission_denied") ||
    message.includes("\"code\":404") ||
    message.includes("\"code\":403")
  );
}

function isImageConfigRejection(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return message.includes("imageconfig") || message.includes("aspect") || message.includes("unknown field");
}

export async function generateGeminiChatImage(input: {
  contents: unknown;
  systemInstruction: string;
  /** Requested frame, e.g. "16:9". Dropped if this model revision rejects it. */
  aspectRatio?: string;
}): Promise<GeminiChatImageResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const ai = new GoogleGenAI({ apiKey });
  const baseConfig = {
    systemInstruction: input.systemInstruction,
    responseModalities: ["IMAGE", "TEXT"],
    httpOptions: { timeout: resolveChatTimeoutMs() },
  };
  const generate = (model: string, config: Record<string, unknown>) =>
    ai.models.generateContent({
      model,
      contents: input.contents as Parameters<
        typeof ai.models.generateContent
      >[0]["contents"],
      config,
    });

  const runModel = async (model: string): Promise<GenerateContentResponse> => {
    if (!input.aspectRatio) return generate(model, baseConfig);
    try {
      return await generate(model, { ...baseConfig, imageConfig: { aspectRatio: input.aspectRatio } });
    } catch (err) {
      // Same fallback as the flyer: a config quirk must not stop the picture.
      if (!isImageConfigRejection(err)) throw err;
      return generate(model, baseConfig);
    }
  };

  const models = resolveChatModels();
  let response: GenerateContentResponse | null = null;
  let model = models[0]!;
  for (let i = 0; i < models.length; i += 1) {
    model = models[i]!;
    try {
      response = await runModel(model);
      break;
    } catch (err) {
      // Only a model this key can't use moves on; anything else is real.
      if (i === models.length - 1 || !isModelUnavailable(err)) throw err;
      console.warn(`[ai-image-chat] ${model} unavailable, falling back:`, err instanceof Error ? err.message : err);
    }
  }
  if (!response) throw new Error("Gemini returned no image data");

  // Thinking models can return draft images marked as thoughts; the finished
  // image is the last one that isn't.
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  let image: { bytes: Buffer; mimeType: string } | null = null;
  const notes: string[] = [];
  for (const part of parts) {
    if (part.thought) continue;
    if (part.inlineData?.data) {
      image = {
        bytes: Buffer.from(part.inlineData.data, "base64"),
        mimeType: part.inlineData.mimeType || "image/png",
      };
    } else if (part.text?.trim()) {
      notes.push(part.text.trim());
    }
  }

  if (!image) {
    throw new Error(describeEmptyResponse(response));
  }

  return {
    imageBytes: image.bytes,
    mimeType: image.mimeType,
    text: notes.join(" ").slice(0, 500) || null,
    modelUsed: `gemini:${model}`,
  };
}
