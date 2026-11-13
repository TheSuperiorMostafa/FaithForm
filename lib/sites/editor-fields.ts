import type { SectionField } from "@/lib/sites/contract";

/** Light uses a full-height photo backdrop. Cropping it to the other themes'
 * narrow banner first discards most of the photo and then enlarges that strip.
 * This only changes framing for new uploads; existing photo URLs stay intact. */
export function sectionEditorFields(fields: SectionField[] | undefined, type: string, themeKey: string): SectionField[] | null {
  if (!fields) return null;
  if (type !== "hero" || themeKey !== "light") return fields;
  return fields.map(field => field.type === "image" && field.key === "image"
    ? { ...field, aspect: "background", label: "Welcome photo" }
    : field);
}
