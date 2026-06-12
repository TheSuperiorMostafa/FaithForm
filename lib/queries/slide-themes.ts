import { createClient } from "@/lib/supabase/server";
import {
  jsonFallbackThemes,
  rowToSlideTheme,
  type SlideTheme,
  type SlideThemeRow,
} from "@/lib/sermon-builder/slide-theme-shared";

export type { SlideTheme, SlideThemeRow } from "@/lib/sermon-builder/slide-theme-shared";
export {
  searchSlideThemes,
  getThemeFilterOptions,
  scoreThemesByTagOverlap,
} from "@/lib/sermon-builder/slide-theme-shared";

let cachedThemes: SlideTheme[] | null = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function listSlideThemes(): Promise<SlideTheme[]> {
  if (cachedThemes && Date.now() < cacheExpiresAt) {
    return cachedThemes;
  }

  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("slide_themes")
      .select("*")
      .eq("active", true)
      .order("sort_order", { ascending: true });

    if (error || !data?.length) {
      cachedThemes = jsonFallbackThemes();
    } else {
      cachedThemes = (data as SlideThemeRow[]).map(rowToSlideTheme);
    }
  } catch {
    cachedThemes = jsonFallbackThemes();
  }

  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return cachedThemes!;
}

export async function getSlideThemeById(
  id: string | null | undefined,
): Promise<SlideTheme | null> {
  const themes = await listSlideThemes();
  return themes.find((t) => t.id === id) ?? null;
}

export async function getThemeAsync(
  id: string | null | undefined,
): Promise<SlideTheme> {
  const theme = await getSlideThemeById(id);
  if (theme) return theme;
  return jsonFallbackThemes().find((t) => t.id === id) ?? jsonFallbackThemes()[0]!;
}

export async function isValidSlideThemeId(id: string): Promise<boolean> {
  const themes = await listSlideThemes();
  return themes.some((t) => t.id === id);
}

export function invalidateSlideThemesCache(): void {
  cachedThemes = null;
  cacheExpiresAt = 0;
}
