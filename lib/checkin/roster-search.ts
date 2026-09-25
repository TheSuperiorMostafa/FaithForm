import type { HouseholdRelationship } from "@/types/checkin";

/**
 * Finding a child at the check-in desk from whatever a volunteer types.
 *
 * ## Why this is not `name.includes(term)`
 *
 * The desk is worked by volunteers with a queue in front of them, and families
 * give whichever name comes to mind first: "Smith, John", "john  smith", "Jose"
 * for José, or a parent's own name ("I'm Sarah, here for the Does"). A substring
 * test over "First Last" missed every one of those, and the old list silently
 * stopped at fifty, so a child could be missing with nothing saying so.
 *
 * So both sides are folded the same way (case, accents and punctuation off),
 * and every word typed has to be the start of a word in the child's own name,
 * their household's name, or one of their guardians' names. Prefix rather than
 * substring, so "ann" finds Anna and Annie rather than every Joanne.
 *
 * It is pure so these rules are pinned by tests instead of rediscovered on a
 * Sunday morning.
 */

/** What the desk knows about a child for the purpose of finding them. */
export type RosterSearchChild = {
  id: string;
  firstName: string;
  lastName: string;
  /** "The Doe Household". Plenty of families answer to this first. */
  householdName: string | null;
  /** The adults who bring this child, so a parent can give their own name. */
  guardianNames: string[];
};

/** A child the desk may check in, as the Today page loads them. */
export type CheckinChild = RosterSearchChild & {
  householdId: string;
  /** The room an admin set as this child's usual place, if any. */
  defaultLocationId: string | null;
  /** Allergies and medical notes, shown on the desk's family card. */
  medicalNotes?: string | null;
};

export type RosterMatch<T extends RosterSearchChild = RosterSearchChild> = {
  child: T;
  /**
   * The guardian whose name the match leaned on, when the child's own name and
   * household did not account for every word typed. Shown on the row, so a
   * volunteer can see why a child they did not name turned up.
   */
  viaGuardian: string | null;
};

export type RosterSearchResult<T extends RosterSearchChild = RosterSearchChild> = {
  /** Children who can still be checked in, best match first, at most `limit`. */
  matches: RosterMatch<T>[];
  /** How many more matched beyond `limit`. Said out loud, never silently cut. */
  more: number;
  /** Children who match but are already checked in, so "nobody" is never a lie. */
  alreadyCheckedIn: RosterMatch<T>[];
};

/**
 * How many rows the list shows. Enough for a family of siblings, few enough to
 * read at a glance; anything past it is a count and a nudge to keep typing.
 */
export const ROSTER_SEARCH_LIMIT = 8;

// ---------------------------------------------------------------------------
// Folding
// ---------------------------------------------------------------------------

/** Letters that Unicode decomposition leaves whole, spelled the way people type them. */
const LETTER_SPELLINGS: Record<string, string> = {
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ø: "o",
  ł: "l",
  đ: "d",
  ð: "d",
  þ: "th",
  ı: "i",
};
const SPELLED_LETTERS = /[ßæœøłđðþı]/g;
const APOSTROPHES = /['’‘ʼ`´]/g;
const MARKS = /\p{M}+/gu;
const NOT_LETTER_OR_DIGIT = /[^\p{L}\p{N}]+/gu;

/**
 * Lower case, accents off, every run of punctuation or space down to a single
 * space. Apostrophes are removed before decomposition, because NFKD turns `´`
 * into a space plus an accent and "O´Brien" would otherwise split in two.
 */
function fold(value: string, apostrophe: "" | " "): string {
  return value
    .toLowerCase()
    .replace(APOSTROPHES, apostrophe)
    .normalize("NFKD")
    .replace(MARKS, "")
    .replace(SPELLED_LETTERS, (letter) => LETTER_SPELLINGS[letter] ?? letter)
    .replace(NOT_LETTER_OR_DIGIT, " ")
    .trim();
}

/**
 * The form both sides of a comparison are put in, so "  Smith, JOSÉ " and
 * "smith jose" are the same search. Apostrophes close up ("O'Brien" is
 * "obrien"); any other mark becomes a space.
 */
export function normalizeSearchText(value: string): string {
  return fold(value, "");
}

/** The separate words of a search, in the order typed. */
export function searchWords(value: string): string[] {
  const folded = normalizeSearchText(value);
  return folded ? folded.split(" ") : [];
}

/**
 * Every word a name can be found by. A name is indexed three ways, so it
 * answers to however a volunteer spells it:
 *
 *   "O'Brien"      → obrien, o, brien
 *   "Mary-Jane"    → mary, jane, maryjane
 *   "Van der Berg" → van, der, berg, vanderberg
 */
function nameTokens(value: string | null | undefined): string[] {
  if (!value) return [];
  const closed = fold(value, "");
  const split = fold(value, " ");
  const joined = closed.replace(/ /g, "");

  const tokens = new Set<string>();
  for (const variant of [closed, split, joined]) {
    for (const word of variant.split(" ")) {
      if (word) tokens.add(word);
    }
  }
  return Array.from(tokens);
}

// ---------------------------------------------------------------------------
// Index and search
// ---------------------------------------------------------------------------

type IndexedChild<T extends RosterSearchChild> = {
  child: T;
  /** Words of the child's own first and last names. */
  own: string[];
  household: string[];
  guardians: { name: string; tokens: string[] }[];
  /** "first last", folded: what a typed full name is compared with. */
  forward: string;
  /** "last first", folded, for "Smith John" and "Smith, John". */
  backward: string;
};

export type RosterSearchIndex<T extends RosterSearchChild = RosterSearchChild> = {
  readonly entries: readonly IndexedChild<T>[];
};

/**
 * Folds every name once, up front. The list is rebuilt only when the children
 * change, not on every keystroke.
 */
export function buildRosterSearchIndex<T extends RosterSearchChild>(
  children: readonly T[],
): RosterSearchIndex<T> {
  return {
    entries: children.map((child) => {
      const first = normalizeSearchText(child.firstName);
      const last = normalizeSearchText(child.lastName);
      return {
        child,
        own: Array.from(
          new Set([...nameTokens(child.firstName), ...nameTokens(child.lastName)]),
        ),
        household: nameTokens(child.householdName),
        guardians: child.guardianNames.map((name) => ({
          name,
          tokens: nameTokens(name),
        })),
        forward: [first, last].filter(Boolean).join(" "),
        backward: [last, first].filter(Boolean).join(" "),
      };
    }),
  };
}

type Scored<T extends RosterSearchChild> = {
  match: RosterMatch<T>;
  /**
   * 0: the whole name, typed exactly, in either order.
   * 1: the start of the whole name ("john sm", "smith jo").
   * 2: every word found in the child's own name.
   * 3: at least one word found only in the household's or a guardian's name.
   */
  tier: number;
  /** Words that are a whole word of the child's name, not just its start. */
  exact: number;
  /** Words found in the child's own name at all. */
  own: number;
  sortName: string;
};

function score<T extends RosterSearchChild>(
  entry: IndexedChild<T>,
  words: string[],
  phrase: string,
): Scored<T> | null {
  let exact = 0;
  let own = 0;
  let viaGuardian: string | null = null;

  for (const word of words) {
    if (entry.own.includes(word)) {
      exact += 1;
      own += 1;
      continue;
    }
    if (entry.own.some((token) => token.startsWith(word))) {
      own += 1;
      continue;
    }
    if (entry.household.some((token) => token.startsWith(word))) continue;

    const guardian = entry.guardians.find((candidate) =>
      candidate.tokens.some((token) => token.startsWith(word)),
    );
    // Every word has to land somewhere. One that lands nowhere rules the child
    // out, which is what makes a second word narrow the list, not widen it.
    if (!guardian) return null;
    viaGuardian ??= guardian.name;
  }

  const tier =
    entry.forward === phrase || entry.backward === phrase
      ? 0
      : entry.forward.startsWith(phrase) || entry.backward.startsWith(phrase)
        ? 1
        : own === words.length
          ? 2
          : 3;

  return {
    match: { child: entry.child, viaGuardian: tier === 3 ? viaGuardian : null },
    tier,
    exact,
    own,
    sortName: entry.backward,
  };
}

function compareScored<T extends RosterSearchChild>(a: Scored<T>, b: Scored<T>): number {
  return (
    a.tier - b.tier ||
    b.exact - a.exact ||
    b.own - a.own ||
    a.sortName.localeCompare(b.sortName) ||
    a.match.child.id.localeCompare(b.match.child.id)
  );
}

/**
 * The children matching `query`, best first.
 *
 * Anyone in `checkedInIds` is kept out of `matches`, since they cannot be
 * checked in twice, but is reported in `alreadyCheckedIn` so the desk can say
 * "Tim is already in the Nursery" instead of claiming nobody matched.
 */
export function searchRoster<T extends RosterSearchChild>(
  index: RosterSearchIndex<T>,
  query: string,
  options: { limit?: number; checkedInIds?: ReadonlySet<string> } = {},
): RosterSearchResult<T> {
  const words = searchWords(query);
  if (words.length === 0) return { matches: [], more: 0, alreadyCheckedIn: [] };

  const phrase = words.join(" ");
  const scored: Scored<T>[] = [];
  for (const entry of index.entries) {
    const hit = score(entry, words, phrase);
    if (hit) scored.push(hit);
  }
  scored.sort(compareScored);

  const available: RosterMatch<T>[] = [];
  const alreadyCheckedIn: RosterMatch<T>[] = [];
  for (const { match } of scored) {
    if (options.checkedInIds?.has(match.child.id)) alreadyCheckedIn.push(match);
    else available.push(match);
  }

  const limit = Math.max(1, options.limit ?? ROSTER_SEARCH_LIMIT);
  return {
    matches: available.slice(0, limit),
    more: Math.max(0, available.length - limit),
    alreadyCheckedIn,
  };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** One `household_members` row with the names the desk searches by. */
export type HouseholdMembership = {
  memberId: string;
  householdId: string;
  relationship: HouseholdRelationship;
  householdName: string | null;
  firstName: string;
  lastName: string;
  isActive: boolean;
  defaultLocationId: string | null;
  medicalNotes?: string | null;
};

/**
 * The children the desk may check in, each carrying their household's name and
 * their guardians' names.
 *
 * Guardians come in only as names attached to a child, never as entries of
 * their own, which is what keeps adults off the desk. Anyone switched off in
 * People is left out on both sides.
 */
export function childrenFromMemberships(
  rows: readonly HouseholdMembership[],
): CheckinChild[] {
  const guardiansByHousehold = new Map<string, string[]>();
  for (const row of rows) {
    if (row.relationship !== "guardian" || !row.isActive) continue;
    const name = `${row.firstName} ${row.lastName}`.trim();
    if (!name) continue;
    const names = guardiansByHousehold.get(row.householdId) ?? [];
    names.push(name);
    guardiansByHousehold.set(row.householdId, names);
  }

  return rows
    .filter((row) => row.relationship === "dependent" && row.isActive)
    .map((row) => ({
      id: row.memberId,
      firstName: row.firstName,
      lastName: row.lastName,
      householdId: row.householdId,
      householdName: row.householdName,
      guardianNames: [...(guardiansByHousehold.get(row.householdId) ?? [])].sort(
        (a, b) => a.localeCompare(b),
      ),
      defaultLocationId: row.defaultLocationId,
      medicalNotes: row.medicalNotes ?? null,
    }))
    .sort(
      (a, b) =>
        a.lastName.localeCompare(b.lastName) ||
        a.firstName.localeCompare(b.firstName),
    );
}
