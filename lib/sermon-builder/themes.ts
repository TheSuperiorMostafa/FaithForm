import slideThemesData from "@/data/slide-themes.json";

export const THEME_CATEGORIES = [
  "traditional",
  "contemporary",
  "seasonal",
  "minimal",
  "bold",
  "nature",
] as const;

export type ThemeCategory = (typeof THEME_CATEGORIES)[number];

export type SlideTheme = {
  id: string;
  name: string;
  description: string;
  category: ThemeCategory;
  tags: string[];
  bg: string;
  bgCss: string;
  text: string;
  accent: string;
  fontHead: string;
  fontBody: string;
  italicRef?: boolean;
  featured?: boolean;
};

export const SLIDE_THEMES: SlideTheme[] = slideThemesData.themes as SlideTheme[];

export const DEFAULT_THEME_ID = "midnight";

const CATEGORY_LABELS: Record<ThemeCategory, string> = {
  traditional: "Traditional",
  contemporary: "Contemporary",
  seasonal: "Seasonal",
  minimal: "Minimal",
  bold: "Bold",
  nature: "Nature",
};

export function getCategoryLabel(category: ThemeCategory): string {
  return CATEGORY_LABELS[category];
}

export function getTheme(id: string | null | undefined): SlideTheme {
  return (
    SLIDE_THEMES.find((t) => t.id === id) ??
    SLIDE_THEMES.find((t) => t.id === DEFAULT_THEME_ID)!
  );
}

export function isValidThemeId(id: string): boolean {
  return SLIDE_THEMES.some((t) => t.id === id);
}

export function getThemeCategories(): { id: ThemeCategory; label: string; count: number }[] {
  const counts = new Map<ThemeCategory, number>();
  for (const cat of THEME_CATEGORIES) counts.set(cat, 0);
  for (const theme of SLIDE_THEMES) {
    counts.set(theme.category, (counts.get(theme.category) ?? 0) + 1);
  }
  return THEME_CATEGORIES.map((id) => ({
    id,
    label: CATEGORY_LABELS[id],
    count: counts.get(id) ?? 0,
  })).filter((c) => c.count > 0);
}

export function searchThemes(
  query: string,
  category?: ThemeCategory | "all",
): SlideTheme[] {
  const q = query.trim().toLowerCase();
  return SLIDE_THEMES.filter((theme) => {
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
  return SLIDE_THEMES.filter((t) => t.featured);
}
