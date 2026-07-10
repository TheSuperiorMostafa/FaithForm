import {
  generateGeminiBackgroundImage,
  isGeminiImageConfigured,
} from "@/lib/ai/image/gemini";
import {
  generateOpenAiBackgroundImage,
  isOpenAiImageConfigured,
} from "@/lib/ai/image/openai";
import type {
  GeneratedBackground,
  GenerateEventBackgroundInput,
} from "@/lib/ai/image/prompt";

export type {
  GeneratedBackground,
  GenerateEventBackgroundInput,
} from "@/lib/ai/image/prompt";

type ImageProvider = "gemini" | "openai";

const PROVIDER_AVAILABILITY: Record<ImageProvider, () => boolean> = {
  gemini: isGeminiImageConfigured,
  openai: isOpenAiImageConfigured,
};

const PROVIDER_GENERATORS: Record<
  ImageProvider,
  (input: GenerateEventBackgroundInput) => Promise<GeneratedBackground>
> = {
  gemini: generateGeminiBackgroundImage,
  openai: generateOpenAiBackgroundImage,
};

/**
 * Resolve the ordered list of image providers to attempt.
 *
 * `IMAGE_PROVIDER` may pin a single provider ("gemini" | "openai"). When unset
 * (or "auto") we prefer Gemini 2.5 Flash Image for its speed and fall back to
 * OpenAI so a provider outage never blocks announcement graphics.
 */
function resolveProviderOrder(): ImageProvider[] {
  const preference = (process.env.IMAGE_PROVIDER ?? "").trim().toLowerCase();

  const configured = (["gemini", "openai"] as ImageProvider[]).filter(
    (provider) => PROVIDER_AVAILABILITY[provider](),
  );

  if (preference === "gemini" || preference === "openai") {
    return configured.filter((provider) => provider === preference);
  }

  // auto: Gemini first (fast), then OpenAI as fallback.
  return configured.sort((a, b) => {
    if (a === b) return 0;
    return a === "gemini" ? -1 : 1;
  });
}

/** Whether any AI image-generation provider is configured. */
export function isAiImageConfigured(): boolean {
  return resolveProviderOrder().length > 0;
}

/**
 * Generate an event background image, trying each configured provider in order
 * and returning the first success. `modelUsed` is prefixed with the provider
 * (e.g. "gemini:gemini-2.5-flash-image") for observability.
 */
export async function generateEventBackgroundImage(
  input: GenerateEventBackgroundInput,
): Promise<GeneratedBackground> {
  const order = resolveProviderOrder();

  if (order.length === 0) {
    throw new Error(
      "No image generation provider configured (set GEMINI_API_KEY or OPENAI_API_KEY)",
    );
  }

  let lastError: Error | null = null;

  for (const provider of order) {
    const startedAt = Date.now();
    try {
      const result = await PROVIDER_GENERATORS[provider](input);
      if (process.env.NODE_ENV !== "test") {
        console.info(
          `[social-graphic] ${result.modelUsed} generated background in ${
            Date.now() - startedAt
          }ms`,
        );
      }
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(
        `[social-graphic] ${provider} image generation failed after ${
          Date.now() - startedAt
        }ms: ${lastError.message}`,
      );
    }
  }

  throw lastError ?? new Error("Could not generate event background image");
}
