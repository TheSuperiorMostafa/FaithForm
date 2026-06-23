const CATEGORY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 32;
const MAX_NAME_LENGTH = 80;
const MAX_CATEGORY_LENGTH = 40;

export function normalizeTag(value: string): string | null {
  const tag = value.trim().toLowerCase().replace(/\s+/g, "-");
  if (!tag || tag.length > MAX_TAG_LENGTH) return null;
  return tag;
}

export function normalizeTagList(raw: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of raw) {
    const parts = item.split(",");
    for (const part of parts) {
      const tag = normalizeTag(part);
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      result.push(tag);
      if (result.length >= MAX_TAGS) return result;
    }
  }

  return result;
}

export function normalizeCategory(raw: string): string | null {
  const category = raw.trim().toLowerCase().replace(/\s+/g, "-");
  if (!category || category.length > MAX_CATEGORY_LENGTH) return null;
  if (!CATEGORY_PATTERN.test(category)) return null;
  return category;
}

export function normalizeThemeName(raw: string): string | null {
  const name = raw.trim();
  if (!name || name.length > MAX_NAME_LENGTH) return null;
  return name;
}

export function buildThemeTaxonomy(
  themes: Array<{
    category: string;
    tags: string[];
    seasonalTags: string[];
    symbolTags: string[];
    visualStyle: string[];
  }>,
) {
  const categories = new Set<string>();
  const tags = new Set<string>();
  const seasonalTags = new Set<string>();
  const symbolTags = new Set<string>();
  const visualStyles = new Set<string>();

  for (const theme of themes) {
    if (theme.category) categories.add(theme.category);
    for (const tag of theme.tags) tags.add(tag);
    for (const tag of theme.seasonalTags) seasonalTags.add(tag);
    for (const tag of theme.symbolTags) symbolTags.add(tag);
    for (const tag of theme.visualStyle) visualStyles.add(tag);
  }

  const sort = (values: Set<string>) =>
    Array.from(values).sort((a, b) => a.localeCompare(b));

  return {
    categories: sort(categories),
    tags: sort(tags),
    seasonalTags: sort(seasonalTags),
    symbolTags: sort(symbolTags),
    visualStyles: sort(visualStyles),
  };
}

export type ThemeTaxonomy = ReturnType<typeof buildThemeTaxonomy>;
