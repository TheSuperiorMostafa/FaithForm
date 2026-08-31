import type { SocialBackgroundTag } from "@/lib/social/constants";

/**
 * Fallback scenery, used only when the writer gave no `imageSubject`.
 *
 * These once described coffee three separate times — a latte under
 * "fellowship", a mug under "prayer", a cup under "bible-study" — and
 * "fellowship" is where a model puts most church events. That is how a summer
 * evening, a youth hangout and a missions day all came back as photographs of
 * the same cup of coffee. Coffee now appears in exactly one bucket, the one
 * that is actually about coffee, and each hint describes something the others
 * do not.
 */
const TAG_SCENE_HINTS: Record<SocialBackgroundTag, string> = {
  youth:
    "cinematic youth worship night, silhouettes of teens with hands raised under warm amber stage haze and golden bokeh string lights, shallow depth of field, energetic and hopeful",
  worship:
    "dramatic sanctuary interior at golden hour, god-rays through tall stained-glass windows, empty wooden pews with soft atmospheric haze, reverent and awe-inspiring",
  outreach:
    "warm neighborhood outreach scene at sunset, open welcoming street with soft sun flare and long shadows, community and hope, cinematic street photography",
  community:
    "long table set outdoors under string lights at dusk, mismatched chairs and shared plates, softly blurred people mid-conversation, shallow depth of field, genuine connection",
  prayer:
    "intimate close-up of weathered hands clasped in prayer over an open Bible on a rustic wooden table, warm rim light and deep chiaroscuro shadows, cross softly blurred in background",
  "bible-study":
    "open Bible with annotated margins and a reading lamp on a weathered wooden table, notebook and pen alongside, warm lamplight, shallow depth of field, quiet and studious",
  fellowship:
    "church fellowship hall in warm afternoon light, folding tables and shared food softly out of focus, people gathered mid-laughter in silhouette, documentary lifestyle photography",
  "seasonal-christmas":
    "elegant Christmas warmth, evergreen branches and softly glowing candlelight with creamy bokeh on dark wood, cozy and sacred",
  "seasonal-easter":
    "hopeful Easter sunrise over rolling hills with an empty cross in soft silhouette, spring light breaking through clouds, cinematic landscape photography",
  family:
    "warm multigenerational family moment in soft natural light, tender and inclusive, gentle bokeh background, lifestyle photography",
  missions:
    "hands loading supply boxes into a van in warm afternoon light, compassion and purpose, documentary-style cinematic photography",
  default:
    "cinematic church event cover photo, warm golden-hour light streaming through large windows across an open interior, shallow depth of field, moody chiaroscuro, spiritual and inviting",
};

export type ImagePromptMode = "background" | "flyer";

export type GenerateEventBackgroundInput = {
  title: string;
  headline: string;
  backgroundTag: SocialBackgroundTag;
  /**
   * The scene written for this one event. Takes precedence over the tag hint,
   * which only ever knew which of twelve buckets the event fell into.
   */
  imageSubject?: string | null;
  churchName: string;
  primaryColor: string;
  location?: string;
  mode?: ImagePromptMode;
  // Flyer-mode fields (text is rendered by the model into the image itself):
  accentColor?: string;
  dateLine?: string;
  timeLine?: string;
  // Optional real logo passed to providers that accept image input (Gemini).
  logo?: { bytes: ArrayBuffer; mimeType: string } | null;
};

export type GeneratedBackground = {
  imageBytes: ArrayBuffer;
  modelUsed: string;
};

/**
 * What to photograph: the event's own scene when the writer supplied one,
 * otherwise the tag's generic fallback. The cinematic treatment is appended
 * either way, so a one-line subject still comes back looking like the rest.
 */
function resolveScene(input: GenerateEventBackgroundInput): string {
  const subject = input.imageSubject?.trim();
  if (subject) {
    return `${subject.replace(/\.$/, "")}. Shot cinematically with dramatic directional light, shallow depth of field, rich filmic color grade, and subtle atmospheric haze`;
  }
  return TAG_SCENE_HINTS[input.backgroundTag] ?? TAG_SCENE_HINTS.default;
}

/** Route to the correct prompt for the requested generation mode. */
export function buildImagePrompt(input: GenerateEventBackgroundInput): string {
  return input.mode === "flyer"
    ? buildFullFlyerPrompt(input)
    : buildBackgroundPrompt(input);
}

/**
 * Prompt for a COMPLETE, ready-to-post church event flyer with all text baked
 * into the image by the model — matching premium designed flyers (bold display
 * title, script accent word, date/time/location block, cinematic photo).
 */
export function buildFullFlyerPrompt(input: GenerateEventBackgroundInput): string {
  const scene = resolveScene(input);
  const title = (input.headline || input.title).trim();
  const details: string[] = [];
  if (input.dateLine?.trim()) details.push(`Date: "${input.dateLine.trim()}"`);
  if (input.timeLine?.trim()) details.push(`Time: "${input.timeLine.trim()}"`);
  if (input.location?.trim()) details.push(`Location: "${input.location.trim()}"`);

  return [
    "Design a complete, professional, ready-to-post CHURCH EVENT FLYER as a single 16:9 landscape graphic — like a premium social media announcement from a modern church marketing team.",
    `Cinematic background photograph: ${scene}. Shot like a high-end campaign with dramatic golden-hour lighting, rich filmic color grade, shallow depth of field, atmospheric haze.`,
    `Overall color palette: warm cinematic tones harmonizing with brand color ${input.primaryColor} and gold accent ${input.accentColor || "#c9a227"}.`,
    "",
    "TEXT TO RENDER ON THE FLYER (spell every word EXACTLY, no misspellings, no extra or invented words, no lorem ipsum):",
    `- Large bold hero TITLE: "${title}". Set it as the dominant headline using a strong, high-impact display typeface. If the title contains a short connecting phrase (like "with the"), render that phrase smaller in an elegant flowing brush-script to create a designed, layered title — exactly like professional church flyers.`,
    `- Church name: "${input.churchName}" in smaller clean spaced uppercase near the top.`,
    details.length
      ? `- Event details block, each on its own line with a small matching icon: ${details.join("; ")}.`
      : "",
    "",
    "LAYOUT: Title and text on the left or lower portion over a darker, legible area of the photo; keep the main photographic subject on the opposite side. Add subtle dark gradient scrims behind text so every word is crisp and highly legible. Include a thin gold divider or small cross accent as a tasteful detail.",
    "TYPOGRAPHY: Use tasteful, real, correctly-spelled typography with excellent kerning. Mix one bold condensed/poster display font for the main title with one elegant script for accents. Text must be sharp, clean, and perfectly readable — NOT warped, garbled, duplicated, or nonsensical.",
    "STYLE: Photorealistic background, polished graphic-design overlay. Looks like a real designer made it in Photoshop. No watermarks, no stock-photo logos, no UI chrome, no borders around the whole image, no page curl.",
    "SUBJECT DISCIPLINE: Photograph the scene described above and nothing else. Do not add coffee cups, mugs, lattes or cafe tables unless that scene explicitly names them — they are not a default for church events.",
    "Output one cohesive finished flyer image.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Prompt for Gemini Flash Image — cinematic, text-free cover photos that match
 * premium church event flyers (prayer breakfasts, coffee with pastor, etc.).
 */
export function buildBackgroundPrompt(
  input: GenerateEventBackgroundInput,
): string {
  const scene = resolveScene(input);
  const locationHint = input.location?.trim()
    ? `Setting may subtly evoke "${input.location}" without showing readable signage.`
    : "";

  return [
    "Ultra-realistic cinematic editorial photograph for a premium church event social media cover.",
    `Event theme: "${input.headline || input.title}" for ${input.churchName}.`,
    `Visual scene: ${scene}.`,
    locationHint,
    "Photography style: shot on a full-frame camera with an 85mm lens, dramatic directional golden-hour lighting, rich filmic color grade, deep contrast, luminous warm highlights, shallow depth of field with creamy bokeh, subtle atmospheric haze, tack-sharp focal subject.",
    `Color palette: warm cinematic tones harmonizing with ${input.primaryColor} — deep browns, amber, navy shadows, and soft gold highlights. Moody yet inviting, never flat or washed out.`,
    "Composition: wide 16:9 landscape. Place the main focal subject toward the right or center-right. Keep the entire left third and bottom-left quadrant darker and visually calm (shadow, soft blur, or negative space) for text overlay legibility.",
    "Do NOT place bright busy detail in the lower-left corner.",
    "Absolutely NO text, letters, words, numbers, dates, times, captions, logos, watermarks, signatures, UI elements, borders, frames, collages, maps, or infographics anywhere in the image.",
    "Photograph the scene described above and nothing else. Do NOT add coffee cups, mugs, lattes or cafe tables unless that scene explicitly names them — they are not a default for church events.",
    "Avoid identifiable staring faces; prefer symbolic objects, hands, silhouettes, architecture, or environments.",
    "Must look like a real professional photograph, not illustrated, cartoon, or 3D-rendered.",
  ]
    .filter(Boolean)
    .join(" ");
}
