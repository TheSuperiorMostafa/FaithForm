import type { SocialBackgroundTag, SocialTemplateKey } from "@/lib/social/constants";

/**
 * The house rule for every generated graphic, stated once and sent every time.
 *
 * A church flyer used to come back as a stock photograph of strangers: a
 * model's idea of "youth" or "fellowship" is a smiling crowd, and no
 * congregation recognises a crowd it has never met. What a church posts is a
 * piece of graphic design, and the model is briefed as a designer, not as a
 * photographer.
 */
export const NO_PEOPLE_RULE =
  "PEOPLE: none. Do not depict any people, faces, portraits, figures, silhouettes, crowds, hands, or body parts anywhere in the image, whether photographed, painted, or drawn. This is a designed graphic, not a photograph of a congregation.";

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
    "bold layered geometric shapes in saturated brand colours, halftone dot and grain textures, an energetic diagonal composition, oversized cropped shapes bleeding off the edges",
  worship:
    "soft radiating light beams over a deep gradient field, fine gold linework echoing arched windows and stained-glass geometry, restrained and reverent, calm negative space",
  outreach:
    "a warm two-tone gradient, abstract map-like line paths with small location-pin icons, friendly rounded shapes, an open and welcoming layout",
  community:
    "overlapping translucent circles in warm tones suggesting gathering, a textured linen or paper background, gentle grain, a simple line-art table setting as an accent",
  prayer:
    "a quiet deep-navy field with a single soft glow, fine linework of a candle and an open book, generous calm negative space",
  "bible-study":
    "a cream paper texture, elegant serif ornaments and thin rule lines, a small line-art open book icon with a ribbon marker, scholarly and warm",
  fellowship:
    "playful cut-paper shapes, a checkered picnic-cloth pattern used as texture, line icons of plates and lanterns, a warm mustard and terracotta palette",
  "seasonal-christmas":
    "an evergreen and gold palette, fine botanical line art of pine sprigs and berries, soft out-of-focus light circles, a subtle star motif",
  "seasonal-easter":
    "a sunrise gradient from deep violet to gold, a simple empty-cross shape on a hill rendered as flat vector, spring florals as delicate line art",
  family:
    "rounded overlapping shapes in a warm friendly palette, house and heart line icons, a soft paper texture, a homely and inclusive feel",
  missions:
    "a world-map dot pattern, compass and dotted route-line motifs, packed supply boxes as simple line icons, an earthy purposeful palette",
  default:
    "an elegant editorial poster: a deep brand-colour field, a subtle arch or window shape, restrained gold accents, fine grain, and a single small cross as a line icon",
};

/**
 * One art direction per layout style the writer picks. The key was already
 * chosen, validated and carried to within one call of the prompt without ever
 * being read; it is the natural place to hang a design brief.
 */
export const ART_DIRECTION: Record<SocialTemplateKey, string> = {
  general:
    "Modern editorial poster design, typography-led, with layered shapes and a subtle paper or grain texture. Confident and clean, the kind of piece a good print designer would make.",
  youth:
    "Bold, energetic poster design: oversized type, high-contrast colour blocking, halftone and grain textures, playful cropped shapes. Loud, but still disciplined.",
  outreach:
    "Warm, welcoming community poster: friendly rounded shapes, generous whitespace, approachable type, soft textures. Inviting rather than slick.",
  "worship-night":
    "Atmospheric, moody design: deep gradients, soft light rays, refined gold accents, elegant restrained type. Quiet and beautiful.",
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
 * Prompt for a COMPLETE, ready-to-post church event flyer with all text baked
 * into the image by the model: a designed poster with a clear hierarchy,
 * texture, shape and iconography, and nobody in it.
 */
export function buildFullFlyerPrompt(input: GenerateEventBackgroundInput): string {
  const scene = resolveScene(input);
  const title = (input.headline || input.title).trim();
  const details: string[] = [];
  if (input.dateLine?.trim()) details.push(`Date: "${input.dateLine.trim()}"`);
  if (input.timeLine?.trim()) details.push(`Time: "${input.timeLine.trim()}"`);
  if (input.location?.trim()) details.push(`Location: "${input.location.trim()}"`);

  return [
    "Design a complete, ready-to-post CHURCH EVENT FLYER as a single 16:9 landscape graphic. It is a piece of graphic design a skilled designer would be proud of, not a stock photograph with words on it.",
    `ART DIRECTION: ${artDirection(input)}`,
    `VISUAL MOTIF: ${scene}. Treat it as designed elements (shapes, texture, line iconography, illustration, abstract light), not as a documentary photo.`,
    `COLOUR: build the palette from the brand colour ${input.primaryColor} and the accent ${input.accentColor || "#c9a227"}, with at most two supporting tones. Cohesive, printable, and never washed out.`,
    NO_PEOPLE_RULE,
    "",
    "TEXT TO RENDER ON THE FLYER (spell every word EXACTLY, no misspellings, no extra or invented words, no lorem ipsum):",
    `- Large hero TITLE: "${title}". The dominant element, set in one display typeface chosen to suit the event: a condensed grotesk, a wide geometric sans, or a refined serif. If the title contains a short connecting phrase (like "with the"), that phrase alone may be set smaller in an elegant script.`,
    `- Church name: "${input.churchName}" in small, clean, letter-spaced uppercase.`,
    details.length
      ? `- Event details, each on its own line with a small matching line icon: ${details.join("; ")}.`
      : "",
    "",
    "LAYOUT: a clear hierarchy on an underlying grid, generous margins, and every word inside the central 80% of the frame so nothing is lost when the edges are cropped. Shapes and texture support the type; they never compete with it. Where type sits over a busy area, use a flat colour panel or a soft scrim so it stays crisp.",
    "TYPOGRAPHY: real, correctly spelled type with excellent kerning; one display face for the title and one clean secondary face for the details. Sharp and legible, never warped, garbled, duplicated, or nonsensical.",
    "STYLE: modern editorial and poster design. Layered flat shapes, subtle paper or grain texture, tasteful gradients, line iconography, illustrated or abstract elements. Photography is allowed only as a treated backdrop of a place or an object (architecture, landscape, still life) with no one in it. No watermarks, no stock-photo logos, no UI chrome, no border around the whole image, no page curl.",
    "SUBJECT DISCIPLINE: design around the motif described above and nothing else. Do not add coffee cups, mugs, lattes or cafe tables unless that motif explicitly names them.",
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
  const locationHint = input.location?.trim()
    ? `The setting may subtly evoke "${input.location}" through architecture or landscape, without readable signage.`
    : "";

  return [
    "A designed background for a premium church event social media graphic, 16:9 landscape.",
    `Event theme: "${input.headline || input.title}" for ${input.churchName}.`,
    `ART DIRECTION: ${artDirection(input)}`,
    `VISUAL MOTIF: ${scene}.`,
    locationHint,
    `COLOUR: a palette built from ${input.primaryColor}, with deep shadows, one warm accent, and fine grain. Moody yet inviting, never flat or washed out.`,
    "COMPOSITION: keep the left third and the bottom-left quadrant calm (flat colour, soft gradient, or negative space) for text to be set over later. Do not place busy detail in the lower-left corner.",
    NO_PEOPLE_RULE,
    "Absolutely NO text, letters, words, numbers, dates, times, captions, logos, watermarks, signatures, UI elements, borders, frames, collages, maps with labels, or infographics anywhere in the image.",
    "Design around the motif described above and nothing else. Do NOT add coffee cups, mugs, lattes or cafe tables unless that motif explicitly names them.",
    "Style: layered shapes, texture, light and line iconography, as a designer would make it. Photography only as a treated backdrop of a place or object with no one in it.",
  ]
    .filter(Boolean)
    .join(" ");
}
