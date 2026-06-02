import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import type { AIProvider } from "@/types/sermon";

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";
const DEFAULT_OPENAI_MODEL = "gpt-4o";

/** Retired model id — remap so saved church overrides keep working. */
const DEPRECATED_ANTHROPIC_MODELS: Record<string, string> = {
  "claude-sonnet-4-20250514": DEFAULT_ANTHROPIC_MODEL,
};

export function resolveAnthropicModelId(modelId?: string | null): string {
  const raw = modelId?.trim() || DEFAULT_ANTHROPIC_MODEL;
  return DEPRECATED_ANTHROPIC_MODELS[raw] ?? raw;
}

export function getModel(provider: AIProvider, modelOverride?: string | null) {
  if (provider === "openai") {
    return openai(
      modelOverride ?? process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL,
    );
  }
  const modelId = resolveAnthropicModelId(
    modelOverride ?? process.env.ANTHROPIC_MODEL,
  );
  return anthropic(modelId);
}

export function modelLabel(provider: AIProvider, modelOverride?: string | null) {
  if (provider === "openai") {
    return modelOverride ?? process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
  }
  return resolveAnthropicModelId(
    modelOverride ?? process.env.ANTHROPIC_MODEL,
  );
}
