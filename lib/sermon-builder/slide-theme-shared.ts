import slideThemesData from "@/data/slide-themes.json";

export type SlideThemeRow = {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  seasonal_tags: string[];
  symbol_tags: string[];
  visual_style: string[];
  background_type: "solid" | "image";
  image_path: string | null;
  bg: string | null;
  bg_css: string | null;
  text_color: string;
  accent_color: string;
  font_head: string;
  font_body: string;
  italic_ref: boolean;
  text_shadow: boolean;
  featured: boolean;
  sort_order: number;
  active: boolean;
};

export type SlideTheme = {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  seasonalTags: string[];
  symbolTags: string[];
  visualStyle: string[];
  backgroundType: "solid" | "image";
  imageUrl: string | null;
  bg: string | null;
  bgCss: string;
  text: string;
  accent: string;
  fontHead: string;
  fontBody: string;
  italicRef: boolean;
  textShadow: boolean;
  featured: boolean;
  sortOrder: number;
};

const BUCKET = "sermon-themes";

export function slideThemePublicUrl(path: string): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/${BUCKET}/${path}`;
}

export function rowToSlideTheme(row: SlideThemeRow): SlideTheme {
  const bgCss =
    row.bg_css ??
    (row.bg ? `#${row.bg.replace(/^#/, "")}` : "#0E1428");

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    tags: row.tags ?? [],
    seasonalTags: row.seasonal_tags ?? [],
    symbolTags: row.symbol_tags ?? [],
    visualStyle: row.visual_style ?? [],
    backgroundType: row.background_type,
    imageUrl: row.image_path ? slideThemePublicUrl(row.image_path) : null,
    bg: row.bg,
    bgCss,
    text: row.text_color,
    accent: row.accent_color,
    fontHead: row.font_head,
    fontBody: row.font_body,
    italicRef: row.italic_ref,
    textShadow: row.text_shadow,
    featured: row.featured,
    sortOrder: row.sort_order,
  };
}

export function jsonFallbackThemes(): SlideTheme[] {
  return (slideThemesData.themes as Array<{
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
  }>).map((t, index) => ({
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
}

export function searchSlideThemes(
  themes: SlideTheme[],
  query: string,
  filters?: {
    category?: string;
    visualStyle?: string;
    seasonal?: string;
  },
): SlideTheme[] {
  const q = query.trim().toLowerCase();

  return themes.filter((theme) => {
    if (filters?.category && filters.category !== "all") {
      if (theme.category !== filters.category) return false;
    }
    if (filters?.visualStyle && filters.visualStyle !== "all") {
      if (!theme.visualStyle.includes(filters.visualStyle)) return false;
    }
    if (filters?.seasonal && filters.seasonal !== "all") {
      if (!theme.seasonalTags.includes(filters.seasonal)) return false;
    }
    if (!q) return true;

    const haystack = [
      theme.name,
      theme.description,
      theme.category,
      ...theme.tags,
      ...theme.seasonalTags,
      ...theme.symbolTags,
      ...theme.visualStyle,
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(q);
  });
}

export function getThemeFilterOptions(themes: SlideTheme[]) {
  const categories = new Map<string, number>();
  const visualStyles = new Map<string, number>();
  const seasonal = new Map<string, number>();

  for (const theme of themes) {
    categories.set(theme.category, (categories.get(theme.category) ?? 0) + 1);
    for (const style of theme.visualStyle) {
      visualStyles.set(style, (visualStyles.get(style) ?? 0) + 1);
    }
    for (const tag of theme.seasonalTags) {
      seasonal.set(tag, (seasonal.get(tag) ?? 0) + 1);
    }
  }

  return {
    categories: Array.from(categories.entries())
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    visualStyles: Array.from(visualStyles.entries())
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    seasonal: Array.from(seasonal.entries())
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function scoreThemesByTagOverlap(
  selected: SlideTheme,
  candidates: SlideTheme[],
  limit = 6,
): string[] {
  const selectedTags = new Set([
    ...selected.tags,
    ...selected.seasonalTags,
    ...selected.symbolTags,
    ...selected.visualStyle,
    selected.category,
  ]);

  const scored = candidates
    .filter((t) => t.id !== selected.id)
    .map((theme) => {
      const tags = [
        ...theme.tags,
        ...theme.seasonalTags,
        ...theme.symbolTags,
        ...theme.visualStyle,
        theme.category,
      ];
      let score = 0;
      for (const tag of tags) {
        if (selectedTags.has(tag)) score += 1;
      }
      if (theme.category === selected.category) score += 2;
      return { id: theme.id, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((s) => s.id);
}

/**
 * Imagery words that show up in scripture, mapped to the theme vocabulary the
 * catalog is tagged with. Used as the deterministic fallback (and pre-filter)
 * for scripture-driven theme suggestions when the AI call is unavailable.
 */
const SCRIPTURE_IMAGERY: Record<string, string[]> = {
  water: ["water", "sea", "ocean", "river", "wave", "baptism", "blue"],
  light: ["light", "dawn", "sunrise", "morning", "bright", "glow"],
  dark: ["night", "darkness", "evening", "shadow", "midnight"],
  fire: ["fire", "flame", "burning", "coal", "furnace"],
  mountain: ["mountain", "hill", "rock", "stone", "cliff"],
  desert: ["desert", "wilderness", "sand", "dry", "barren"],
  harvest: ["harvest", "field", "grain", "wheat", "seed", "vineyard", "fruit"],
  shepherd: ["shepherd", "sheep", "flock", "lamb", "pasture"],
  storm: ["storm", "wind", "tempest", "thunder", "rain", "flood"],
  cross: ["cross", "crucified", "calvary", "blood", "sacrifice"],
  bread: ["bread", "feast", "table", "wine", "cup", "supper"],
  sky: ["heaven", "sky", "cloud", "star", "moon", "sun"],
  nature: ["tree", "garden", "forest", "leaf", "branch", "vine", "flower"],
  royal: ["king", "throne", "crown", "kingdom", "reign", "majesty"],
  peace: ["peace", "rest", "still", "quiet", "comfort"],
  celebration: ["joy", "rejoice", "praise", "sing", "glad", "celebration"],
};

/**
 * Ranks themes by how well their tags match the imagery actually present in a
 * passage's text.
 */
export function scoreThemesByScriptureText(
  scriptureText: string,
  candidates: SlideTheme[],
  limit = 6,
): string[] {
  const words = Array.from(
    new Set(
      scriptureText
        .toLowerCase()
        .replace(/[^a-z\s]/g, " ")
        .split(/\s+/)
        .filter(Boolean),
    ),
  );
  if (words.length === 0) return [];

  // Concept -> how strongly the passage evokes it.
  const conceptWeight: Array<[string, number]> = [];
  for (const [concept, triggers] of Object.entries(SCRIPTURE_IMAGERY)) {
    let hits = 0;
    for (const trigger of triggers) {
      // Match stems too, so "waters"/"watered" still count as "water".
      if (words.some((w) => w === trigger || w.startsWith(trigger))) {
        hits += 1;
      }
    }
    if (hits > 0) conceptWeight.push([concept, hits]);
  }
  if (conceptWeight.length === 0) return [];

  const scored = candidates
    .map((theme) => {
      const tags = new Set(
        [
          ...theme.tags,
          ...theme.seasonalTags,
          ...theme.symbolTags,
          ...theme.visualStyle,
          theme.category,
          theme.name,
        ].map((t) => t.toLowerCase()),
      );

      let score = 0;
      for (const [concept, weight] of conceptWeight) {
        if (tags.has(concept)) score += weight * 3;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        for (const trigger of SCRIPTURE_IMAGERY[concept]!) {
          if (tags.has(trigger)) score += weight;
        }
      }
      return { id: theme.id, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((s) => s.id);
}
