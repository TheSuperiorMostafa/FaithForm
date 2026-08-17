import { createClient } from "@/lib/supabase/server";
import {
  jsonFallbackThemes,
  rowToSlideTheme,
  slideThemePublicUrl,
  type SlideTheme,
  type SlideThemeRow,
} from "@/lib/sermon-builder/slide-theme-shared";

export { slideThemePublicUrl };

export type { SlideTheme, SlideThemeRow } from "@/lib/sermon-builder/slide-theme-shared";
export {
  searchSlideThemes,
  getThemeFilterOptions,
  scoreThemesByTagOverlap,
  scoreThemesByScriptureText,
  UPLOADS_CATEGORY,
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

/**
 * A church's own uploaded themes. Deliberately uncached — the module-level
 * cache above is shared across tenants and must only ever hold the global
 * catalog.
 */
export async function listChurchSlideThemes(
  churchId: string,
): Promise<SlideTheme[]> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("slide_themes")
      .select("*")
      .eq("active", true)
      .eq("church_id", churchId)
      .order("created_at", { ascending: false });

    if (error || !data) return [];
    return (data as SlideThemeRow[]).map(rowToSlideTheme);
  } catch {
    return [];
  }
}

/** Platform catalog plus the church's uploads, uploads first. */
export async function listSlideThemesForChurch(
  churchId: string | null,
): Promise<SlideTheme[]> {
  const global = await listSlideThemes();
  if (!churchId) return global;
  const own = await listChurchSlideThemes(churchId);
  return [...own, ...global];
}

/** Church uploads live outside the cached global catalog, so look them up directly. */
async function fetchThemeRow(id: string): Promise<SlideTheme | null> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("slide_themes")
      .select("*")
      .eq("id", id)
      .eq("active", true)
      .maybeSingle();
    if (error || !data) return null;
    return rowToSlideTheme(data as SlideThemeRow);
  } catch {
    return null;
  }
}

export async function getSlideThemeById(
  id: string | null | undefined,
): Promise<SlideTheme | null> {
  if (!id) return null;
  const themes = await listSlideThemes();
  const global = themes.find((t) => t.id === id);
  if (global) return global;
  // RLS already limits an upload to the church that owns it.
  return fetchThemeRow(id);
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
  if (themes.some((t) => t.id === id)) return true;
  return (await fetchThemeRow(id)) !== null;
}

export function invalidateSlideThemesCache(): void {
  cachedThemes = null;
  cacheExpiresAt = 0;
}
