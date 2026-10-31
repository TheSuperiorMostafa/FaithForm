import type { SocialBackgroundTag, SocialTemplateKey } from "@/lib/social/constants";

/**
 * The house rule for every generated graphic, stated once and sent every time.
 *
 * A church flyer used to come back as a stock photograph of strangers: a
 * model's idea of "youth" or "fellowship" is a smiling crowd, and no
 * congregation recognises a crowd it has never met. What a church posts is a
 * piece of design built around a place or a still life, so the model is
 * told to show the setting and the things in it, never the people.
 */
export const NO_PEOPLE_RULE =
  "PEOPLE: none. Do not depict any people, faces, portraits, figures, silhouettes, crowds, hands, or body parts anywhere in the image, whether photographed, painted, or drawn. Show the place and the things in it, never a congregation.";

/**
 * Words that mean a scene is about people. A writer-supplied subject that
 * uses one is set aside for the tag's motif, because a rule in the prompt is
 * not enough once the subject itself says "teenagers together".
 */
export const PEOPLE_WORDS =
  /\b(people|person|persons|someone|everyone|anyone|men|women|man|woman|guys|girls|boys|kids?|children|child|teens?|teenagers?|youth group|students?|families|family|friends?|crowd|congregation|volunteers?|worshippers?|hands?|faces?|silhouettes?|figures?|portraits?|couple|parents?|mother|father|mom|dad|grandparents?|baby|babies|toddlers?|pastor|preacher|speaker|team|group of)\b/i;

/**
 * Fallback motifs, used only when the writer gave no `imageSubject`.
 *
 * Each one describes shapes, textures, objects, light, and iconography, never
 * a scene of people. They are the visual vocabulary a designer would reach
 * for, one distinct vocabulary per kind of event, so a youth night and a
 * prayer breakfast do not come back looking like the same poster.
 */
export const TAG_SCENE_HINTS: Record<SocialBackgroundTag, string> = {
  youth:
    "an empty youth room at night lit by bold coloured stage light in the brand colours, a stack of worn Bibles and a guitar on a stool, haze catching the beams, energetic and modern",
  worship:
    "a quiet sanctuary at dusk with warm light pouring through tall arched windows across empty wooden pews, soft haze and glowing candles at the front, reverent and cinematic",
  outreach:
    "a welcoming open church door at golden hour with a painted wooden welcome board with no lettering, potted flowers and warm string lights spilling onto the steps",
  community:
    "a long harvest table set for a shared meal under warm string lights, mismatched plates, fresh bread and seasonal flowers, inviting and generous",
  prayer:
    "a single candle glowing beside an open Bible on a wooden kneeler in a dim chapel, a soft shaft of window light, calm and intimate",
  "bible-study":
    "an open, well-worn Bible with handwritten notes, a notebook, a pen and reading glasses on a warm wooden table by a window, soft lamplight and shallow depth of field",
  fellowship:
    "a backyard picnic spread at golden hour: a checkered cloth, lanterns, bowls of food and lemonade jars on a wooden table, string lights overhead",
  "seasonal-christmas":
    "a softly lit sanctuary decorated with evergreen garlands, gold ornaments and glowing candles, a simple nativity star overhead, warm bokeh lights",
  "seasonal-easter":
    "an empty stone tomb opening onto a sunrise over a spring hillside, lilies in the foreground with dew, golden light breaking through",
  family:
    "a cozy living-room table with board games, popcorn bowls, warm blankets and soft lamp light, playful and homely",
  missions:
    "packed supply boxes, a weathered world map and a passport-style journal on a wooden table, a compass and route lines, warm purposeful light",
  default:
    "the exterior of a welcoming church building at blue hour with warm light glowing from its windows, a clear sky in the brand colour, cinematic and calm",
};

/**
 * One art direction per layout style the writer picks. Each one is a rich,
 * photographic key visual with designed type over it — the look pastors were
 * getting from a general-purpose image app, and the flat abstract posters
 * were not.
 */
export const ART_DIRECTION: Record<SocialTemplateKey, string> = {
  general:
    "Premium editorial event poster: a rich, cinematic photograph of the scene as the hero visual, dramatic natural light and shallow depth of field, colour-graded toward the brand palette, with clean, confident typography set on a soft gradient scrim.",
  youth:
    "Bold, high-energy event graphic: a vivid photograph lit with saturated brand-colour light, high contrast, subtle grain, oversized display type with a modern condensed face. Loud, but disciplined.",
  outreach:
    "Warm, welcoming community poster: a sunlit, inviting photograph of the place, golden tones, generous breathing room for friendly, approachable type.",
  "worship-night":
    "Atmospheric, moody worship graphic: a low-light photograph with haze, light rays and candle glow, deep brand-colour shadows, refined gold accents, elegant restrained type.",
};

export type ImagePromptMode = "background" | "flyer";

export type GenerateEventBackgroundInput = {
  title: string;
  headline: string;
  backgroundTag: SocialBackgroundTag;
  /**
   * The motif written for this one event. Takes precedence over the tag hint,
   * which only ever knew which of twelve buckets the event fell into.
   */
  imageSubject?: string | null;
  /** The layout style the writer chose; decides the art direction. */
  templateKey?: SocialTemplateKey | null;
  churchName: string;
  primaryColor: string;
  /**
   * The ONE short location line to print, already resolved from what the
   * church saved (see lib/social/event-details). Null leaves it off.
   */
  location?: string | null;
  /** "autumn", "winter"... from the event date, for the light and mood. */
  season?: string | null;
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
 * What to design around: the event's own motif when the writer supplied one
 * that is about things rather than people, otherwise the tag's fallback.
 */
export function resolveScene(input: GenerateEventBackgroundInput): string {
  const subject = input.imageSubject?.trim();
  if (subject && !PEOPLE_WORDS.test(subject)) {
    return subject.replace(/\.$/, "");
  }
  return TAG_SCENE_HINTS[input.backgroundTag] ?? TAG_SCENE_HINTS.default;
}

function artDirection(input: GenerateEventBackgroundInput): string {
  return ART_DIRECTION[input.templateKey ?? "general"] ?? ART_DIRECTION.general;
}

/** Route to the correct prompt for the requested generation mode. */
export function buildImagePrompt(input: GenerateEventBackgroundInput): string {
  return input.mode === "flyer"
    ? buildFullFlyerPrompt(input)
    : buildBackgroundPrompt(input);
}

/**
 * Prompt for a COMPLETE, ready-to-post church event flyer with its text baked
 * in by the model: a cinematic photograph of the event's scene with designed
 * typography, nobody in it, and as few words as possible so every one of them
 * is spelled right.
 */
export function buildFullFlyerPrompt(input: GenerateEventBackgroundInput): string {
  const scene = resolveScene(input);
  const title = (input.headline || input.title).trim();
  // Only offer a script accent for words the title really has; offered in the
  // abstract, the model wrote "with the" into "Ladies Bible Study".
  const connector = title.match(/\b(with the|with|at the|of the|and the|for the)\b/i)?.[0] ?? null;
  const details: string[] = [];
  if (input.dateLine?.trim()) details.push(`"${input.dateLine.trim()}"`);
  if (input.timeLine?.trim()) details.push(`"${input.timeLine.trim()}"`);
  if (input.location?.trim()) details.push(`"${input.location.trim()}"`);
  const season = input.season?.trim()
    ? `Set it in ${input.season.trim()}: let the light, colour temperature and any natural details feel like ${input.season.trim()}.`
    : "";

  return [
    "Design a complete, ready-to-post CHURCH EVENT FLYER as a single 16:9 landscape graphic, the quality of a professional church communications team: a striking, cinematic hero image with polished graphic-design typography over it. Not flat clip-art, not a generic stock photo with words pasted on.",
    `ART DIRECTION: ${artDirection(input)}`,
    `HERO SCENE: ${scene}. Photographic and richly detailed: real materials and textures, dramatic natural light, depth of field, a clear focal point, professional colour grading.`,
    season,
    `COLOUR: grade the image and accents toward the brand colour ${input.primaryColor} and the accent ${input.accentColor || "#C5A059"}. Cohesive, rich, and never washed out or muddy.`,
    NO_PEOPLE_RULE,
    "",
    "TEXT TO RENDER (these are the ONLY words allowed in the image). Copy each one character for character: same spelling, same capitalisation, same digits and punctuation. Do not translate, abbreviate, expand, correct, or add words such as a city, state, zip code, web address, or slogan:",
    `- Large hero TITLE: "${title}", exactly these words in this order, nothing added or removed. The dominant element, in one display typeface chosen to suit the event (a condensed grotesk, a wide geometric sans, or a refined serif).${connector ? ` The connecting words "${connector}" may be set smaller in an elegant script.` : ""}`,
    `- Church name: "${input.churchName}" in small, clean, letter-spaced uppercase.`,
    details.length
      ? `- Details, set small on one or two lines with thin separators or tiny line icons: ${details.join(" · ")}.`
      : "",
    "",
    "LAYOUT: put the text on the calmer side of the image over a soft gradient scrim or a subtle brand-colour panel so it is crisp and high-contrast; keep the hero scene clearly visible on the other side. Every word inside the central 80% of the frame so nothing is lost when the edges are cropped.",
    "TYPOGRAPHY: real, correctly spelled type with excellent kerning; one display face for the title and one clean secondary face for the details. Sharp and legible, never warped, garbled, duplicated, mirrored, or nonsensical. If you cannot set a word perfectly, set it larger and simpler rather than inventing letters.",
    "No watermarks, no stock-photo logos, no extra signage or readable text in the scene itself, no UI chrome, no border around the whole image, no page curl.",
    "SUBJECT DISCIPLINE: build the image around the hero scene described above and nothing else. Do not add coffee cups, mugs, lattes or cafe tables unless that scene explicitly names them.",
    "Output one cohesive finished flyer image.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Prompt for a text-free designed backdrop, for a layout that sets its own
 * type. Same vocabulary as the flyer: shapes, texture, light, iconography,
 * and no people.
 */
export function buildBackgroundPrompt(
  input: GenerateEventBackgroundInput,
): string {
  const scene = resolveScene(input);

  return [
    "A designed background for a premium church event social media graphic, 16:9 landscape.",
    `Event theme: "${input.headline || input.title}" for ${input.churchName}.`,
    `ART DIRECTION: ${artDirection(input)}`,
    `HERO SCENE: ${scene}.`,
    `COLOUR: a palette built from ${input.primaryColor}, with deep shadows, one warm accent, and fine grain. Moody yet inviting, never flat or washed out.`,
    "COMPOSITION: keep the left third and the bottom-left quadrant calm (flat colour, soft gradient, or negative space) for text to be set over later. Do not place busy detail in the lower-left corner.",
    NO_PEOPLE_RULE,
    "Absolutely NO text, letters, words, numbers, dates, times, captions, logos, watermarks, signatures, UI elements, borders, frames, collages, maps with labels, or infographics anywhere in the image.",
    "Design around the motif described above and nothing else. Do NOT add coffee cups, mugs, lattes or cafe tables unless that motif explicitly names them.",
    "Style: a cinematic, richly lit photograph of the scene with real textures and depth of field, colour-graded toward the brand palette, with no one in it.",
  ]
    .filter(Boolean)
    .join(" ");
}
