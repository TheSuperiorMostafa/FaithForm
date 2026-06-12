import slideThemesData from "@/data/slide-themes.json";
import {
  getSlideThemeById,
  isValidSlideThemeId,
  listSlideThemes,
  type SlideTheme,
} from "@/lib/queries/slide-themes";

export type { SlideTheme };
export type ThemeCategory = string;

export const DEFAULT_THEME_ID = "midnight";

const JSON_THEMES: SlideTheme[] = (
  slideThemesData.themes as Array<{
    id: string;
    name: string;
    description: string;
    category: string;
    tags: string[];
    bg: string;
    bgCss: string;
    text: string;
    accent: string;
    fontHead: string;
    fontBody: string;
    italicRef?: boolean;
    featured?: boolean;
  }>
).map((t, index) => ({
  id: t.id,
  name: t.name,
  description: t.description,
  category: t.category,
  tags: t.tags,
  seasonalTags: [],
  symbolTags: [],
  visualStyle: [],
  backgroundType: "solid" as const,
  imageUrl: null,
  bg: t.bg,
  bgCss: t.bgCss,
  text: t.text,
  accent: t.accent,
  fontHead: t.fontHead,
  fontBody: t.fontBody,
  italicRef: t.italicRef ?? false,
  textShadow: false,
  featured: t.featured ?? false,
  sortOrder: index,
}));

function getThemeFromJson(id: string | null | undefined): SlideTheme {
  return (
    JSON_THEMES.find((t) => t.id === id) ??
    JSON_THEMES.find((t) => t.id === DEFAULT_THEME_ID)!
  );
}

/** Sync fallback using bundled JSON (used when theme object isn't available). */
export function getTheme(id: string | null | undefined): SlideTheme {
  return getThemeFromJson(id);
}

export async function getThemeAsync(
  id: string | null | undefined,
): Promise<SlideTheme> {
  const theme = await getSlideThemeById(id);
  return theme ?? getThemeFromJson(id);
}

export async function isValidThemeId(id: string): Promise<boolean> {
  return isValidSlideThemeId(id);
}

export function isValidThemeIdSync(id: string): boolean {
  return JSON_THEMES.some((t) => t.id === id);
}

export { listSlideThemes, getSlideThemeById, isValidSlideThemeId };

export const CATEGORY_LABELS: Record<string, string> = {
  traditional: "Traditional",
  contemporary: "Contemporary",
  seasonal: "Seasonal",
  minimal: "Minimal",
  bold: "Bold",
  nature: "Nature",
};

export function getCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

// Legacy exports for validate:themes script
export const SLIDE_THEMES = JSON_THEMES;

export function getThemeCategories(): {
  id: string;
  label: string;
  count: number;
}[] {
  const counts = new Map<string, number>();
  for (const theme of JSON_THEMES) {
    counts.set(theme.category, (counts.get(theme.category) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([id, count]) => ({
    id,
    label: getCategoryLabel(id),
    count,
  }));
}

export function searchThemes(
  query: string,
  category?: string | "all",
): SlideTheme[] {
  const q = query.trim().toLowerCase();
  return JSON_THEMES.filter((theme) => {
    if (category && category !== "all" && theme.category !== category) {
      return false;
    }
    if (!q) return true;
    const haystack = [
      theme.name,
      theme.description,
      theme.category,
      ...theme.tags,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

export function getFeaturedThemes(): SlideTheme[] {
  return JSON_THEMES.filter((t) => t.featured);
}
