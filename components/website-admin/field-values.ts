import type { SectionField } from "@/lib/sites/contract";

type Bag = Record<string, unknown>;

/** Every initial value agrees with the control the editor displays. */
export function blankSectionItem(fields: SectionField[]): Bag {
  return Object.fromEntries(fields.map(field => {
    if (field.type === "list" || field.type === "paragraphs") return [field.key, []];
    if (field.type === "group") return [field.key, blankSectionItem(field.fields)];
    if (field.type === "toggle") return [field.key, false];
    if (field.type === "image") return [field.key, { src: null, alt: "" }];
    if (field.type === "headline") return [field.key, { lead: "" }];
    if (field.type === "select") return [field.key, field.options[0]?.value ?? ""];
    if (field.type === "number") return [field.key, null];
    return [field.key, ""];
  }));
}

/** Reordering changes position, while keeping all hidden fields and photos. */
export function moveSectionListItem<T>(items: T[], from: number, direction: -1 | 1): T[] {
  const to = from + direction;
  if (from < 0 || from >= items.length || to < 0 || to >= items.length) return items;
  const next = [...items];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** Clearing one colour must preserve all other church customizations. */
export function clearBrandToken(tokens: Record<string, string>, key: string): Record<string, string> {
  const next = { ...tokens };
  delete next[key];
  return next;
}
