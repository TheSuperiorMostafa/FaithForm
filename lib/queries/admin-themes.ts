import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildThemeTaxonomy,
  type ThemeTaxonomy,
} from "@/lib/sermon-builder/theme-taxonomy";
import {
  rowToSlideTheme,
  type SlideTheme,
  type SlideThemeRow,
} from "@/lib/sermon-builder/slide-theme-shared";

export type AdminSlideThemeRow = SlideTheme;

export async function getAdminSlideThemes(): Promise<AdminSlideThemeRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("slide_themes")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("getAdminSlideThemes:", error.message);
    return [];
  }

  return ((data ?? []) as SlideThemeRow[]).map(rowToSlideTheme);
}

export async function getThemeTaxonomy(): Promise<ThemeTaxonomy> {
  const themes = await getAdminSlideThemes();
  return buildThemeTaxonomy(themes);
}
