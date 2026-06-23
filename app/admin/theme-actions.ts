"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth/superadmin";
import {
  normalizeCategory,
  normalizeTagList,
  normalizeThemeName,
} from "@/lib/sermon-builder/theme-taxonomy";
import { invalidateSlideThemesCache } from "@/lib/queries/slide-themes";
import { createAdminClient } from "@/lib/supabase/admin";

export type UpdateSlideThemeInput = {
  id: string;
  name: string;
  category: string;
  tags: string[];
  seasonalTags: string[];
  symbolTags: string[];
  visualStyles: string[];
};

export type UpdateSlideThemeResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateSlideTheme(
  input: UpdateSlideThemeInput,
): Promise<UpdateSlideThemeResult> {
  await requireSuperAdmin();

  const id = input.id?.trim();
  if (!id) {
    return { ok: false, error: "Theme id is required." };
  }

  const name = normalizeThemeName(input.name ?? "");
  if (!name) {
    return { ok: false, error: "Theme name must be 1–80 characters." };
  }

  const category = normalizeCategory(input.category ?? "");
  if (!category) {
    return {
      ok: false,
      error: "Category must be lowercase letters, numbers, and hyphens only.",
    };
  }

  const tags = normalizeTagList(input.tags ?? []);
  const seasonalTags = normalizeTagList(input.seasonalTags ?? []);
  const symbolTags = normalizeTagList(input.symbolTags ?? []);
  const visualStyles = normalizeTagList(input.visualStyles ?? []);

  const admin = createAdminClient();
  const { data: existing, error: readError } = await admin
    .from("slide_themes")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (readError) {
    console.error("updateSlideTheme read:", readError.message);
    return { ok: false, error: "Could not load theme." };
  }
  if (!existing) {
    return { ok: false, error: "Theme not found." };
  }

  const { error } = await admin
    .from("slide_themes")
    .update({
      name,
      category,
      tags,
      seasonal_tags: seasonalTags,
      symbol_tags: symbolTags,
      visual_style: visualStyles,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    console.error("updateSlideTheme:", error.message);
    return { ok: false, error: "Failed to save theme." };
  }

  invalidateSlideThemesCache();
  revalidatePath("/admin/themes");
  revalidatePath("/api/sermon/themes");

  return { ok: true };
}
