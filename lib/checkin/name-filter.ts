/**
 * Turning a typed name into a PostgREST filter it cannot break.
 *
 * `.or()` takes one string that PostgREST parses as syntax: commas separate
 * conditions, parentheses group them, dots split a column from its operator,
 * double quotes and backslashes quote and escape, and inside a LIKE pattern
 * `*` means the same as `%`. So "Smith, John" used to become two conditions,
 * one of them malformed, the whole read failed, and because the failure was
 * swallowed the desk said nobody matched. And on the kiosk, "a**" was a
 * three-character query that matched everyone whose name contains an A.
 *
 * A search is cut down to what names are made of (letters in any script,
 * accents, digits, apostrophes, hyphens and single spaces) before it goes near
 * a filter string. Nothing a real name contains is lost, and nothing PostgREST
 * reads as syntax survives.
 */

const NOT_PART_OF_A_NAME = /[^\p{L}\p{M}\p{N}'’\- ]+/gu;
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** Longest search kept. A name is never longer; a filter string should not be. */
const MAX_SEARCH_LENGTH = 80;

/** The search with everything that is not part of a name replaced by a space. */
export function sanitizeNameSearch(value: string): string {
  return value
    .replace(NOT_PART_OF_A_NAME, " ")
    .replace(/ +/g, " ")
    .trim()
    .slice(0, MAX_SEARCH_LENGTH)
    .trim();
}

/** The words of a search worth matching: each has a letter or digit in it. */
export function nameSearchWords(value: string): string[] {
  return sanitizeNameSearch(value)
    .split(" ")
    .filter((word) => HAS_LETTER_OR_DIGIT.test(word));
}

/**
 * The `.or()` filter on `members` for "a person called this".
 *
 * One word may be either name. Two or more are read as a first and a last
 * name in either order ("John Smi", "Smith John"), or as a single name with a
 * space in it ("Mary Ann", "Van der Berg"). The old filter compared the whole
 * of "John Smi" with each name on its own, so it matched nobody.
 */
export function memberNameFilter(search: string): string | null {
  const words = nameSearchWords(search);
  if (words.length === 0) return null;

  if (words.length === 1) {
    const anywhere = `%${words[0]}%`;
    return `first_name.ilike.${anywhere},last_name.ilike.${anywhere}`;
  }

  const first = `%${words[0]}%`;
  const last = `%${words[words.length - 1]}%`;
  const whole = `%${words.join("%")}%`;
  return [
    `and(first_name.ilike.${first},last_name.ilike.${last})`,
    `and(first_name.ilike.${last},last_name.ilike.${first})`,
    `first_name.ilike.${whole}`,
    `last_name.ilike.${whole}`,
  ].join(",");
}

/** The `ilike` pattern for a household's own name: every word, in order. */
export function householdNamePattern(search: string): string | null {
  const words = nameSearchWords(search);
  return words.length === 0 ? null : `%${words.join("%")}%`;
}
