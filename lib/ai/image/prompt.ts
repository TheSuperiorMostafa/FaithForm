import type { SocialBackgroundTag } from "@/lib/social/constants";

const TAG_SCENE_HINTS: Record<SocialBackgroundTag, string> = {
  youth:
    "cinematic youth worship night, silhouettes of teens with hands raised under warm amber stage haze and golden bokeh string lights, shallow depth of field, energetic and hopeful",
  worship:
    "dramatic sanctuary interior at golden hour, god-rays through tall stained-glass windows, empty wooden pews with soft atmospheric haze, reverent and awe-inspiring",
  outreach:
    "warm neighborhood outreach scene at sunset, open welcoming street with soft sun flare and long shadows, community and hope, cinematic street photography",
  community:
    "candid church community gathering in warm natural window light, softly blurred people sharing a meal, shallow depth of field, genuine connection",
  prayer:
    "intimate close-up of weathered hands clasped in prayer over an open Bible beside a ceramic coffee mug on a rustic wooden table, warm rim light and deep chiaroscuro shadows, cross softly blurred in background",
  "bible-study":
    "cozy Bible study still life, open Bible with highlighted pages and steaming coffee on a weathered wooden table under warm lamp light, shallow depth of field, inviting",
  fellowship:
    "artisan coffee cup with heart-shaped latte art on a rustic wooden table, steam rising, warm cafe window light with golden bokeh, Heine Bros-style coffee shop atmosphere",
  "seasonal-christmas":
    "elegant Christmas warmth, evergreen branches and softly glowing candlelight with creamy bokeh on dark wood, cozy and sacred",
  "seasonal-easter":
    "hopeful Easter sunrise over rolling hills with an empty cross in soft silhouette, spring light breaking through clouds, cinematic landscape photography",
  family:
    "warm multigenerational family moment in soft natural light, tender and inclusive, gentle bokeh background, lifestyle photography",
  missions:
    "hands serving together outdoors in warm afternoon light, compassion and purpose, documentary-style cinematic photography",
  default:
    "cinematic church event cover photo, warm golden-hour light streaming through large windows onto rustic wooden surfaces, shallow depth of field, moody chiaroscuro, spiritual and inviting",
};

export type ImagePromptMode = "background" | "flyer";

export type GenerateEventBackgroundInput = {
  title: string;
  headline: string;
  backgroundTag: SocialBackgroundTag;
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
  const scene = TAG_SCENE_HINTS[input.backgroundTag] ?? TAG_SCENE_HINTS.default;
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
  const scene = TAG_SCENE_HINTS[input.backgroundTag] ?? TAG_SCENE_HINTS.default;
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
    "Avoid identifiable staring faces; prefer symbolic objects, hands, silhouettes, architecture, or environments.",
    "Must look like a real professional photograph, not illustrated, cartoon, or 3D-rendered.",
  ]
    .filter(Boolean)
    .join(" ");
}
