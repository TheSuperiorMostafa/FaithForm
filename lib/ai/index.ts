import {
  extractJsonMiddleware,
  generateObject,
  generateText,
  Output,
  streamText,
  wrapLanguageModel,
} from "ai";
import type { z } from "zod";
import { stripJsonFences } from "@/lib/ai/json-repair";
import { getChurchAISettings } from "@/lib/queries/sermons";
import { getModel, modelLabel } from "@/lib/ai/providers";
import type { AIProvider } from "@/types/sermon";

export type AIMessage = { role: "user" | "assistant" | "system"; content: string };

export async function resolveModelForChurch(
  churchId: string,
  opts?: { fast?: boolean },
) {
  const settings = await getChurchAISettings(churchId);
  const provider = (settings?.ai_provider ?? "anthropic") as AIProvider;
  const model = getModel(provider, settings?.ai_model_override, opts);
  const label = modelLabel(provider, settings?.ai_model_override, opts);
  return { model, provider, label, settings };
}

export async function aiGenerateText(opts: {
  churchId: string;
  system: string;
  prompt: string;
  maxOutputTokens?: number;
}) {
  const { model, label } = await resolveModelForChurch(opts.churchId);
  const result = await generateText({
    model,
    system: opts.system,
    prompt: opts.prompt,
    maxOutputTokens: opts.maxOutputTokens ?? 4096,
  });
  return { text: result.text, modelUsed: label };
}

export async function aiGenerateObject<T extends z.ZodType>(opts: {
  churchId: string;
  system: string;
  prompt: string;
  schema: T;
  maxOutputTokens?: number;
  /** Prefer the fast model when the church has no explicit model override. */
  fast?: boolean;
}) {
  const { model, label } = await resolveModelForChurch(opts.churchId, {
    fast: opts.fast,
  });
  const result = await generateObject({
    model,
    system: opts.system,
    prompt: opts.prompt,
    schema: opts.schema,
    maxOutputTokens: opts.maxOutputTokens ?? 4096,
    experimental_repairText: async ({ text }) => {
      const repaired = stripJsonFences(text);
      return repaired !== text ? repaired : null;
    },
  });
  return { object: result.object as z.infer<T>, modelUsed: label };
}

/** For large JSON payloads (full sermon drafts). Uses generateText + Output.object + JSON fence stripping. */
export async function aiGenerateLargeObject<T extends z.ZodType>(opts: {
  churchId: string;
  system: string;
  prompt: string;
  schema: T;
  maxOutputTokens?: number;
}) {
  const { model, label } = await resolveModelForChurch(opts.churchId);
  const jsonModel = wrapLanguageModel({
    model,
    middleware: extractJsonMiddleware(),
  });

  const result = await generateText({
    model: jsonModel,
    system: opts.system,
    prompt: opts.prompt,
    maxOutputTokens: opts.maxOutputTokens ?? 16384,
    output: Output.object({ schema: opts.schema }),
  });

  if (result.output == null) {
    throw new Error(
      "The AI response could not be parsed as a sermon draft. Try again or shorten the target duration.",
    );
  }

  return { object: result.output as z.infer<T>, modelUsed: label };
}

export async function aiStreamText(opts: {
  churchId: string;
  system: string;
  prompt: string;
  maxOutputTokens?: number;
}) {
  const { model, label } = await resolveModelForChurch(opts.churchId);
  const result = streamText({
    model,
    system: opts.system,
    prompt: opts.prompt,
    maxOutputTokens: opts.maxOutputTokens ?? 8192,
  });
  return { result, modelUsed: label };
}
