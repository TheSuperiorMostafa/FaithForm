import type { SectionField } from "@/lib/sites/contract";
import { deepMerge } from "@/lib/sites/resolve";

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const safeUrl = (value: string) => !value || /^(https?:\/\/|mailto:|tel:|#|\/(?!\/))/i.test(value) && !/[\u0000-\u0020]/.test(value);

/** Apply only the fields this section actually exposes. Keep structural/theme
 * fields and unknown legacy customization intact, even with a forged action. */
export function editableSectionContent(fields: SectionField[], baseline: Record<string, unknown>, submitted: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const field of fields) {
    if (!Object.hasOwn(submitted, field.key)) continue;
    const value = submitted[field.key];
    // Optional inherited copy/images often resolve to null. Editing a nearby
    // field must not make those untouched values invalid.
    if (value === null && baseline[field.key] === null) continue;
    const invalid = () => { throw new Error(`Check ${field.label.toLowerCase()} and try again.`); };
    switch (field.type) {
      case "text": case "textarea": case "url": case "select":
        if (typeof value !== "string" || value.length > 20_000) invalid();
        if (field.type === "url" && !safeUrl(value as string)) invalid();
        if (field.type === "select" && !field.options.some(o => o.value === value)) invalid();
        patch[field.key] = value; break;
      case "toggle":
        if (typeof value !== "boolean") invalid();
        patch[field.key] = value; break;
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value) || value < (field.min ?? -Infinity) || value > (field.max ?? Infinity)) invalid();
        patch[field.key] = value; break;
      case "paragraphs":
        if (!Array.isArray(value) || value.length > 100 || !value.every(v => typeof v === "string" && v.length <= 20_000)) invalid();
        patch[field.key] = value; break;
      case "headline": case "image": {
        if (!record(value)) { invalid(); break; }
        const keys = field.type === "headline" ? ["lead", "accent", "trail"] : ["src", "alt", "placeholder"];
        const kept: Record<string, unknown> = {};
        for (const key of keys) {
          if (!Object.hasOwn(value, key)) continue;
          const entry = value[key];
          if (typeof entry !== "string" && !(key === "src" && entry === null)) invalid();
          if (typeof entry === "string" && (entry.length > 20_000 || key === "src" && !safeUrl(entry))) invalid();
          kept[key] = entry;
        }
        patch[field.key] = kept; break;
      }
      case "group":
        if (!record(value)) { invalid(); break; }
        patch[field.key] = editableSectionContent(field.fields, record(baseline[field.key]) ? baseline[field.key] as Record<string, unknown> : {}, value); break;
      case "list":
        if (!Array.isArray(value) || value.length > 100 || !value.every(record)) { invalid(); break; }
        // Existing list records retain fields omitted from the editing surface.
        patch[field.key] = value.map((item, index) => editableSectionContent(field.itemFields, Array.isArray(baseline[field.key]) && record((baseline[field.key] as unknown[])[index]) ? (baseline[field.key] as Record<string, unknown>[])[index] : {}, item)); break;
    }
  }
  return deepMerge(baseline, patch);
}
