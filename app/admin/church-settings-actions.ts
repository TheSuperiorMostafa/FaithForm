"use server";

import { revalidatePath } from "next/cache";

import { requireSuperAdmin } from "@/lib/auth/superadmin";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AIProvider, SermonBuilderMode } from "@/types/sermon";

export type ChurchSettingsFormState = {
  ok: boolean;
  error?: string;
};

/**
 * AI configuration is ours to tune, not the church's — pastors shouldn't have
 * to reason about model providers. This writes with the service-role client
 * because a platform admin is not a member of the church they're editing.
 */
export async function updateChurchAISettings(
  _prev: ChurchSettingsFormState,
  formData: FormData,
): Promise<ChurchSettingsFormState> {
  await requireSuperAdmin();

  const churchId = formData.get("church_id")?.toString();
  if (!churchId) return { ok: false, error: "Missing church." };

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

  const admin = createAdminClient();
  const { error } = await admin.from("church_settings").upsert(
    {
      church_id: churchId,
      ai_provider,
      sermon_builder_mode,
      preaching_style: formData.get("preaching_style")?.toString() || null,
      ai_model_override:
        formData.get("ai_model_override")?.toString().trim() || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "church_id" },
  );

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/admin/churches/${churchId}`);
  // Sermon Builder reads provider + mode on every render.
  revalidatePath("/dashboard/sermon-builder", "layout");

  return { ok: true };
}
