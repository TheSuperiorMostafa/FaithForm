/**
 * A section headline is stored in three parts — `lead`, an optional `accent`
 * (drawn in the theme's serif italic) and an optional `trail` — and rendered
 * as `lead accent trail` with single spaces between them.
 *
 * The editor shows it as one plain "Headline" box. These two helpers convert
 * between the one box and the three parts, keeping the highlighted words
 * highlighted for as long as they still appear in what the person typed.
 */

export type HeadlineParts = {
  lead?: string;
  accent?: string | null;
  trail?: string | null;
  [key: string]: unknown;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const BOUNDARY = /[\s.,!?;:'"()\u2014\u2013-]/;

/**
 * Where `phrase` appears in `text` as whole words, or -1. A highlight that
 * starts or ends mid-word would render with a stray space ("Grace ful"),
 * because the parts are always joined with spaces.
 */
function findWords(text: string, phrase: string): number {
  let from = 0;
  while (from <= text.length) {
    const at = text.indexOf(phrase, from);
    if (at === -1) return -1;
    const before = at === 0 ? "" : text[at - 1];
    const after = text[at + phrase.length] ?? "";
    if ((!before || BOUNDARY.test(before)) && (!after || BOUNDARY.test(after))) return at;
    from = at + 1;
  }
  return -1;
}

/**
 * Split `text` around the words at `at`. Punctuation straight after the
 * highlight ("Grace." or "Grace,") stays attached to it, again so the joined
 * headline has no space before the full stop.
 */
function splitAt(text: string, at: number, length: number) {
  let end = at + length;
  while (end < text.length && /[.,!?;:'")]/.test(text[end])) end += 1;
  return {
    lead: text.slice(0, at).trim(),
    accent: text.slice(at, end).trim(),
    trail: text.slice(end).trim(),
  };
}

/** The headline as a visitor reads it. */
export function joinHeadline(parts: HeadlineParts | null | undefined): string {
  if (!parts) return "";
  return [parts.lead, parts.accent, parts.trail]
    .map(clean)
    .filter(Boolean)
    .join(" ");
}

/**
 * The three parts for a newly typed headline.
 *
 * If the words that were highlighted are still in the text, they stay
 * highlighted and the text either side becomes `lead` / `trail`. Otherwise the
 * highlight is dropped and everything goes in `lead` — a headline can never
 * show words the person has deleted.
 */
export function splitHeadline(
  text: string,
  previous: HeadlineParts | null | undefined,
): HeadlineParts {
  const base: HeadlineParts = { ...(previous ?? {}) };
  const accent = clean(previous?.accent);

  if (accent) {
    const at = findWords(text, accent);
    if (at !== -1) return { ...base, ...splitAt(text, at, accent.length) };
  }

  return { ...base, lead: text, accent: "", trail: "" };
}

/**
 * Highlight a phrase inside the current headline. Returns null when the phrase
 * is not in the headline as whole words, so the caller can say so instead of
 * guessing.
 */
export function highlightWords(
  parts: HeadlineParts | null | undefined,
  words: string,
): HeadlineParts | null {
  const full = joinHeadline(parts);
  const phrase = words.trim();
  if (!phrase) return { ...(parts ?? {}), lead: full, accent: "", trail: "" };

  const at = findWords(full, phrase);
  if (at === -1) return null;

  return { ...(parts ?? {}), ...splitAt(full, at, phrase.length) };
}
