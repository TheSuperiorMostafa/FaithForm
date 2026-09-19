/**
 * Which of a church's recurring events an announcement is about.
 *
 * Calendar titles are typed in a hurry and change from week to week: "Men's
 * Breakfast", "Mens Breakfast - Oct 5", "October Men's Prayer Breakfast 2026".
 * The church profile names each recurring event once, plus any other names it
 * goes by, and this decides which of those a title means. The announcement
 * writer then uses what the church said about that event.
 *
 * Pure and deterministic: no clock, no database. A wrong match is worse than
 * none, because it puts one event's details into another event's caption, so
 * every rule here leans towards "no match".
 */

export type RecurringEventMatchKind = "exact" | "contains" | "overlap";

/** The parts of a recurring event that matching reads. */
export type RecurringEventCandidate = {
  id?: string | null;
  name: string;
  aliases?: readonly string[] | null;
  /** Paused events still match, and then nothing is used. See `matchRecurringEvent`. */
  isActive?: boolean | null;
  cadence?: string | null;
  description?: string | null;
  sortOrder?: number | null;
};

export type EventMatchInput = {
  title: string;
  location?: string | null;
  startAt?: string | null;
  /** A date-only calendar entry, whose `startAt` is midnight UTC by convention. */
  allDay?: boolean;
  /** The church's IANA zone, so an 8pm Saturday event is not read as Sunday. */
  timeZone?: string | null;
};

export type RecurringEventMatch<T> = {
  event: T;
  kind: RecurringEventMatchKind;
  /** The name or alias that matched, as the church wrote it. */
  matchedName: string;
  /** Within a kind, higher is closer: coverage for "contains", overlap for "overlap". */
  score: number;
};

/**
 * Below this share of the longer name, a contained name is a coincidence
 * rather than a match: "Prayer" sits inside "Men's Prayer Breakfast", but the
 * breakfast is not the Wednesday prayer meeting.
 */
export const CONTAINS_MIN_COVERAGE = 0.5;

/** The share of words two names must have in common (Jaccard) to count as one event. */
export const OVERLAP_MIN = 0.6;

// Words that change nothing about which event is meant. Deliberately short:
// "weekly" and "night" look like filler but are how churches tell events apart.
const FILLER_WORDS = new Set([
  "a",
  "an",
  "the",
  "our",
  "your",
  "my",
  "annual",
  "of",
  "and",
  "at",
  "for",
  "with",
  "in",
  "on",
  "to",
  "am",
  "pm",
]);

const MONTH =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const WEEKDAY =
  "(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\\.?";
const DAY = "\\d{1,2}(?:st|nd|rd|th)?";
const YEAR = "(?:19|20)\\d{2}";

/**
 * Dates, times, years, ordinals and stray numbers, in the order they are cut.
 *
 * A weekday is only cut as part of a date ("Sat, Oct 5"). On its own it is
 * part of the name: "Wednesday Night Prayer" and "Sunday Night Prayer" are two
 * different events. A month is likewise only cut next to a day or a year, so
 * "March for Life" keeps its first word.
 */
const DATE_PATTERNS: RegExp[] = [
  // "Sat, Oct 5", "October 5th, 2026"
  new RegExp(
    `\\b(?:${WEEKDAY},?\\s+)?${MONTH}\\s+${DAY}\\b(?:,?\\s+${YEAR}\\b)?`,
    "g",
  ),
  // "5th of October", "5 Oct 2026"
  new RegExp(`\\b${DAY}\\s+(?:of\\s+)?${MONTH}(?:,?\\s+${YEAR})?\\b`, "g"),
  // "October 2026"
  new RegExp(`\\b${MONTH}\\s+${YEAR}\\b`, "g"),
  // "7pm", "7:30 p.m."
  /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)(?![a-z])/g,
  // "10:30"
  /\b\d{1,2}:\d{2}\b/g,
  // "10/5", "10/05/2026", "2026-10-05"
  /\b\d{1,4}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b/g,
  new RegExp(`\\b${YEAR}\\b`, "g"),
  // "3rd", "21st"
  /\b\d+(?:st|nd|rd|th)\b/g,
  // "Week 3", "Day 2": an instance counter, never the event's identity.
  /\b\d+\b/g,
];

/**
 * A month on its own in a calendar title marks which edition it is ("October
 * Men's Prayer Breakfast"), so titles lose it. The church's own names keep
 * theirs, and "March" and "May" are left alone everywhere: they are words
 * ("Palm Sunday March") far more often than they are editions.
 */
const EDITION_MONTH =
  /\b(?:january|february|april|june|july|august|september|october|november|december)\b/g;

// Where a calendar title splits into a program name and a subtitle:
// "VBS Day 3: Under the Sea", "Youth Night | Pizza", "Men's Breakfast (Guest)".
const SEGMENT_BREAK = /\s+[-–—]\s+|[–—|•·()[\]]|:(?!\d)/;

/** "mens" and "men's" and "men" are one word here; so are "night" and "nights". */
function stem(token: string): string {
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

/**
 * The words of an event name that identify it: lowercase, no accents,
 * apostrophes joined ("men's" → "mens"), dates, years, ordinals, times and
 * punctuation removed, and filler words like "the", "our", "annual" dropped.
 *
 * `asTitle` is for the announcement side: a calendar title also loses a month
 * standing on its own (see `EDITION_MONTH`).
 */
export function eventNameTokens(
  text: string,
  options: { asTitle?: boolean } = {},
): string[] {
  let normalized = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’‘`]/g, "");

  for (const pattern of DATE_PATTERNS) {
    normalized = normalized.replace(pattern, " ");
  }
  if (options.asTitle) normalized = normalized.replace(EDITION_MONTH, " ");

  return normalized
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1 && !FILLER_WORDS.has(token))
    .map(stem);
}

/** `eventNameTokens` as one comparable string: "the annual Men's Breakfast 2026" → "men breakfast". */
export function normalizeEventName(text: string): string {
  return eventNameTokens(text).join(" ");
}

/** Every name an event answers to: its own, then its aliases. */
export function recurringEventNames(event: {
  name: string;
  aliases?: readonly string[] | null;
}): string[] {
  return [event.name, ...(event.aliases ?? [])].filter((name) => name.trim());
}

type Comparison = { kind: RecurringEventMatchKind; score: number };

const KIND_RANK: Record<RecurringEventMatchKind, number> = {
  exact: 3,
  contains: 2,
  overlap: 1,
};

function compareNames(title: string[], name: string[]): Comparison | null {
  if (!title.length || !name.length) return null;

  const titleText = title.join(" ");
  const nameText = name.join(" ");
  if (titleText === nameText) return { kind: "exact", score: 1 };

  // Contained on whole words: "mens bible study" is not inside "womens bible study".
  const [shorter, longer] =
    title.length <= name.length ? [title, name] : [name, title];
  if (` ${longer.join(" ")} `.includes(` ${shorter.join(" ")} `)) {
    const coverage = shorter.length / longer.length;
    if (coverage >= CONTAINS_MIN_COVERAGE) {
      return { kind: "contains", score: coverage };
    }
  }

  const a = new Set(title);
  const b = new Set(name);
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  const overlap = shared / (a.size + b.size - shared);
  if (overlap >= OVERLAP_MIN) return { kind: "overlap", score: overlap };

  return null;
}

/**
 * The whole title first, then each part of it, so "VBS Day 3: Under the Sea"
 * is tried as "VBS Day 3" too. A part scores a hair below the whole, so the
 * full title wins a tie.
 */
function titleVariants(title: string): { tokens: string[]; penalty: number }[] {
  const seen = new Set<string>();
  const variants: { tokens: string[]; penalty: number }[] = [];
  const add = (text: string, penalty: number) => {
    const tokens = eventNameTokens(text, { asTitle: true });
    const key = tokens.join(" ");
    if (!key || seen.has(key)) return;
    seen.add(key);
    variants.push({ tokens, penalty });
  };

  add(title, 0);
  title.split(SEGMENT_BREAK).forEach((part, index) => add(part, (index + 1) / 1000));
  return variants;
}

function weekdayOf(input: EventMatchInput): string | null {
  if (!input.startAt) return null;
  const date = new Date(input.startAt);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      // A date-only entry is midnight UTC by convention; any other zone moves it.
      timeZone: input.allDay ? "UTC" : input.timeZone || "UTC",
    })
      .format(date)
      .toLowerCase();
  } catch {
    return null;
  }
}

/**
 * How well the when and where agree with an event, used only to break a tie
 * between two equally good title matches: "Night Prayer" on a Wednesday is the
 * Wednesday one. Never enough to make a match on its own.
 */
function hintScore(
  event: RecurringEventCandidate,
  weekday: string | null,
  locationTokens: Set<string>,
): number {
  let score = 0;

  if (weekday) {
    const said = eventNameTokens(
      [event.cadence, event.name, ...(event.aliases ?? [])].filter(Boolean).join(" "),
    );
    // "Sunday", "Sundays", "Sun", "Thurs" all name the day.
    if (said.some((token) => token.length >= 3 && weekday.startsWith(token))) {
      score += 2;
    }
  }

  if (locationTokens.size) {
    const about = eventNameTokens(
      [event.cadence, event.description].filter(Boolean).join(" "),
    );
    if (about.some((token) => locationTokens.has(token))) score += 1;
  }

  return score;
}

/**
 * The recurring event an announcement is about, or null.
 *
 * Tried in order, on every name and alias the event goes by: an exact match
 * once dates and filler are gone, then one name contained in the other (whole
 * words, covering at least half of the longer), then words in common (at least
 * 60%). The strongest kind wins; within a kind, the closer match; then the
 * event whose usual day and place agree with this one; then the church's own
 * ordering.
 *
 * Paused events take part, and when one wins the answer is null. Pausing
 * "Men's Breakfast" means "write its announcements without these notes", not
 * "borrow the notes from Men's Prayer Breakfast instead".
 */
export function matchRecurringEvent<T extends RecurringEventCandidate>(
  events: readonly T[],
  input: EventMatchInput,
): RecurringEventMatch<T> | null {
  const variants = titleVariants(input.title ?? "");
  if (!variants.length || !events.length) return null;

  const weekday = weekdayOf(input);
  const locationTokens = new Set(
    eventNameTokens(input.location ?? "").filter((token) => token.length > 2),
  );

  let best: Ranked<T> | null = null;

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    let eventBest: Ranked<T> | null = null;

    for (const name of recurringEventNames(event)) {
      const nameTokens = eventNameTokens(name);
      for (const variant of variants) {
        const comparison = compareNames(variant.tokens, nameTokens);
        if (!comparison) continue;
        const candidate: Ranked<T> = {
          event,
          kind: comparison.kind,
          matchedName: name,
          score: comparison.score - variant.penalty,
          rank: KIND_RANK[comparison.kind],
          hints: 0,
          order: index,
        };
        if (!eventBest || isBetter(candidate, eventBest)) eventBest = candidate;
      }
    }

    if (!eventBest) continue;
    eventBest.hints = hintScore(event, weekday, locationTokens);
    if (!best || isBetter(eventBest, best)) best = eventBest;
  }

  if (!best || best.event.isActive === false) return null;

  return {
    event: best.event,
    kind: best.kind,
    matchedName: best.matchedName,
    score: best.score,
  };
}

type Ranked<T extends RecurringEventCandidate> = RecurringEventMatch<T> & {
  rank: number;
  hints: number;
  order: number;
};

function isBetter<T extends RecurringEventCandidate>(a: Ranked<T>, b: Ranked<T>): boolean {
  if (a.rank !== b.rank) return a.rank > b.rank;
  if (Math.abs(a.score - b.score) > 1e-9) return a.score > b.score;
  if (a.hints !== b.hints) return a.hints > b.hints;
  const aSort = a.event.sortOrder ?? 0;
  const bSort = b.event.sortOrder ?? 0;
  if (aSort !== bSort) return aSort < bSort;
  return a.order < b.order;
}

/**
 * The first of `candidate`'s names that another of the church's events already
 * answers to, once normalised.
 *
 * Two events answering to the same name would leave matching to guess, so the
 * admin console refuses the second one. "The Table" and "Table" are the same
 * name here, exactly as they are to `matchRecurringEvent`.
 */
export function findRecurringEventNameConflict<
  T extends { id?: string | null; name: string; aliases?: readonly string[] | null },
>(
  existing: readonly T[],
  candidate: { id?: string | null; name: string; aliases?: readonly string[] | null },
): { name: string; takenBy: T } | null {
  const taken = new Map<string, T>();
  for (const event of existing) {
    if (candidate.id && event.id === candidate.id) continue;
    for (const name of recurringEventNames(event)) {
      const key = normalizeEventName(name);
      if (key && !taken.has(key)) taken.set(key, event);
    }
  }

  for (const name of recurringEventNames(candidate)) {
    const takenBy = taken.get(normalizeEventName(name));
    if (takenBy) return { name, takenBy };
  }
  return null;
}
