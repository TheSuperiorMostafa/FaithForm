const FILLER_WORDS = new Set([
  "with",
  "the",
  "a",
  "an",
  "at",
  "for",
  "and",
  "of",
  "to",
]);

function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9']/g, ""))
    .filter((word) => word.length > 0 && !FILLER_WORDS.has(word));
}

/**
 * Pick the best headline for the flyer overlay. Prefer the original event title
 * when the AI over-compresses it (e.g. "Coffee with the Pastor" → "Coffee Pastor").
 */
export function resolveFlyerHeadline(title: string, aiHeadline: string): string {
  const eventTitle = title.trim();
  const generated = aiHeadline.trim();

  if (!generated) return eventTitle;
  if (!eventTitle) return generated;

  const titleLower = eventTitle.toLowerCase();
  const headlineLower = generated.toLowerCase();

  if (titleLower.includes(" with ") && !headlineLower.includes(" with ")) {
    return eventTitle;
  }

  const titleWords = contentWords(eventTitle);
  const headlineWords = contentWords(generated);

  if (
    titleWords.length > headlineWords.length &&
    headlineWords.every((word) => titleWords.includes(word))
  ) {
    return eventTitle;
  }

  const collapsedTitle = titleLower.replace(/[^a-z0-9]/g, "");
  const collapsedHeadline = headlineLower.replace(/[^a-z0-9]/g, "");
  if (
    collapsedTitle.includes(collapsedHeadline) &&
    collapsedTitle.length > collapsedHeadline.length
  ) {
    return eventTitle;
  }

  if (eventTitle.length <= 48 && eventTitle.split(/\s+/).length <= 7) {
    return eventTitle;
  }

  return generated;
}

/**
 * Split a headline into bold primary + script accent lines, matching premium
 * church flyer layouts (e.g. "COFFEE" + "with the Pastor").
 */
export function splitHeadlineForFlyer(headline: string): {
  primary: string;
  script: string | null;
} {
  const cleaned = headline.trim();
  if (!cleaned) return { primary: "JOIN US", script: null };

  const withTheMatch = cleaned.match(/^(.+?)\s+(with\s+the\s+.+)$/i);
  if (withTheMatch) {
    return {
      primary: withTheMatch[1].trim().toUpperCase(),
      script: withTheMatch[2].trim(),
    };
  }

  const withMatch = cleaned.match(/^(.+?)\s+(with\s+.+)$/i);
  if (withMatch) {
    return {
      primary: withMatch[1].trim().toUpperCase(),
      script: withMatch[2].trim(),
    };
  }

  const words = cleaned.split(/\s+/);
  if (words.length >= 2) {
    const script = words.pop()!;
    return { primary: words.join(" ").toUpperCase(), script };
  }

  return { primary: cleaned.toUpperCase(), script: null };
}
