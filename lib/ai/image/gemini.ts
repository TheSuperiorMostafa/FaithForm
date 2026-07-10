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
