"use server";

import { revalidatePath } from "next/cache";
import { getChurchAuth } from "@/lib/auth/church";
import { upsertChurchSettings } from "@/lib/queries/sermons";
import type { AIProvider, SermonBuilderMode } from "@/types/sermon";

export type SettingsFormState = {
  ok: boolean;
  error?: string;
};

export async function updateAISettings(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const auth = await getChurchAuth();
  if (!auth) {
    return { ok: false, error: "Not signed in." };
  }
  if (!auth.isAdmin) {
    return { ok: false, error: "Only church admins can change AI settings." };
  }

  const ai_provider = formData.get("ai_provider")?.toString() as AIProvider;
  if (ai_provider !== "anthropic" && ai_provider !== "openai") {
    return { ok: false, error: "Invalid provider." };
  }

  const sermon_builder_mode = formData
    .get("sermon_builder_mode")
    ?.toString() as SermonBuilderMode;
  if (sermon_builder_mode !== "simple" && sermon_builder_mode !== "advanced") {
    return { ok: false, error: "Invalid sermon builder mode." };
  }

  try {
    await upsertChurchSettings(auth.churchId, {
      ai_provider,
      sermon_builder_mode,
      preaching_style: formData.get("preaching_style")?.toString() || null,
      denomination: formData.get("denomination")?.toString() || null,
      ai_model_override:
        formData.get("ai_model_override")?.toString().trim() || null,
    });
    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard/sermon-builder");
    revalidatePath("/dashboard/sermon-builder/new");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not save settings.",
    };
  }
}
