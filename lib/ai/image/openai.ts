import {
  buildImagePrompt,
  type GeneratedBackground,
  type GenerateEventBackgroundInput,
} from "@/lib/ai/image/prompt";

const IMAGE_MODELS = ["gpt-image-2", "gpt-image-1"] as const;
const DEFAULT_TIMEOUT_MS = 45_000;

type OpenAIImageResponse = {
  data?: Array<{ b64_json?: string; url?: string }>;
  error?: { message?: string };
};

export function isOpenAiImageConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function resolveTimeoutMs(): number {
  const raw = Number(process.env.OPENAI_IMAGE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

async function fetchImageBytesFromResult(item: {
  b64_json?: string;
  url?: string;
}): Promise<ArrayBuffer> {
  if (item.b64_json) {
    const binary = Buffer.from(item.b64_json, "base64");
    return binary.buffer.slice(
      binary.byteOffset,
      binary.byteOffset + binary.byteLength,
    );
  }

  if (item.url) {
    const res = await fetch(item.url);
    if (!res.ok) {
      throw new Error(`Failed to download generated image (${res.status})`);
    }
    return res.arrayBuffer();
  }

  throw new Error("OpenAI image response did not include image data");
}

async function requestBackgroundImage(
  model: string,
  prompt: string,
): Promise<ArrayBuffer> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), resolveTimeoutMs());

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt,
        size: "1536x1024",
        quality: "medium",
        n: 1,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`OpenAI image request timed out after ${resolveTimeoutMs()}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  const data = (await res.json()) as OpenAIImageResponse;

  if (!res.ok) {
    throw new Error(
      data.error?.message ?? `OpenAI image request failed (${res.status})`,
    );
  }

  const first = data.data?.[0];
  if (!first) {
    throw new Error("OpenAI image response was empty");
  }

  return fetchImageBytesFromResult(first);
}

export async function generateOpenAiBackgroundImage(
  input: GenerateEventBackgroundInput,
): Promise<GeneratedBackground> {
  const prompt = buildImagePrompt(input);
  const preferredModel =
    process.env.OPENAI_IMAGE_MODEL?.trim() || IMAGE_MODELS[0];
  const modelsToTry = [
    preferredModel,
    ...IMAGE_MODELS.filter((model) => model !== preferredModel),
  ];

  let lastError: Error | null = null;

  for (const model of modelsToTry) {
    try {
      const imageBytes = await requestBackgroundImage(model, prompt);
      return { imageBytes, modelUsed: `openai:${model}` };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError ?? new Error("Could not generate OpenAI event background");
}
