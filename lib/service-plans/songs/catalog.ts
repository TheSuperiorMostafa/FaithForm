/**
 * The shared song catalog (migration 0180): facts about songs every church can
 * search, keyed by CCLI number, never lyrics. Pure helpers only, shared by the
 * server code in `catalog-server.ts`, the screens and the unit tests.
 */

/** One catalog row as the add-song search shows it. */
export type CatalogSong = {
  id: string;
  ccliNumber: string | null;
  title: string;
  author: string | null;
  copyright: string | null;
  themes: string[];
  defaultKey: string | null;
  tempo: number | null;
  isPublicDomain: boolean;
};

/** Facts a church's song may add to the catalog. Never lyrics or charts. */
export type CatalogFacts = {
  ccli_number: string;
  title: string;
  author: string | null;
  copyright: string | null;
  default_key: string | null;
  tempo: number | null;
  themes: string[];
  source: "church";
};

const CCLI = /^[0-9]{1,10}$/;

/** The exact song on SongSelect, or null when there is no valid CCLI number. */
export function songSelectUrl(ccliNumber: string | null | undefined): string | null {
  const digits = ccliNumber?.trim() ?? "";
  return CCLI.test(digits) ? `https://songselect.ccli.com/songs/${digits}` : null;
}

/** Spaces, punctuation and full-text query operators; letters in any script stay. */
const SEPARATORS = /[\s&|!():*<>'"`\\,.;?\-\u2010-\u2015\u2018-\u201f/#@%^$+=~[\]{}]+/;

export type CatalogQuery = { ccli: string | null; tsquery: string | null; text: string };

/**
 * What a search box means. "22025", "CCLI 22025", "#22025" and
 * "CCLI Song # 22025" look up that number; anything else is title or writer
 * words, matched as prefixes ("amaz gra" finds "Amazing Grace").
 */
export function catalogQuery(raw: unknown): CatalogQuery {
  const text = typeof raw === "string" ? raw.trim().slice(0, 120) : "";
  const number = /^(?:ccli\s*(?:song\s*)?(?:#|no\.?|number)?\s*:?\s*)?#?\s*([0-9]{1,10})$/i.exec(text);
  if (number) return { ccli: number[1], tsquery: null, text };
  const words = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(SEPARATORS)
    .filter(Boolean)
    .slice(0, 8);
  return { ccli: null, tsquery: words.length ? words.map((w) => `${w}:*`).join(" & ") : null, text };
}

/**
 * Facts-only catalog row from a church's song, or null when it has no CCLI
 * number (the catalog is keyed by it). Lyrics and charts are not accepted.
 */
export function catalogFacts(song: {
  ccliNumber: string | null;
  title: string;
  author?: string | null;
  copyright?: string | null;
  defaultKey?: string | null;
  tempo?: number | null;
  themes?: string[];
}): CatalogFacts | null {
  const ccli = song.ccliNumber?.trim() ?? "";
  const title = song.title.trim().slice(0, 200);
  if (!CCLI.test(ccli) || !title) return null;
  const tempo = typeof song.tempo === "number" && song.tempo >= 20 && song.tempo <= 300 ? Math.round(song.tempo) : null;
  return {
    ccli_number: ccli,
    title,
    author: song.author?.trim().slice(0, 300) || null,
    copyright: song.copyright?.trim().slice(0, 500) || null,
    default_key: song.defaultKey?.trim().slice(0, 8) || null,
    tempo,
    themes: (song.themes ?? []).map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 20),
    source: "church",
  };
}

// ---------------------------------------------------------------------------
// Matching an imported file to a song already in the library
// ---------------------------------------------------------------------------

export type LibraryIdentity = { id: string; title: string; ccliNumber: string | null };

export type LibraryMatch = { songId: string; title: string; reason: "ccli" | "title" };

function titleKey(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .split(SEPARATORS)
    .filter(Boolean)
    .join(" ");
}

/**
 * The library song a file belongs to: by CCLI number first (certain), then by
 * title (a guess the church confirms before anything is attached). A file
 * whose CCLI number belongs to no library song is not matched by title to a
 * song that has a different CCLI number.
 */
export function matchLibrarySong(
  file: { title: string; ccliNumber: string | null },
  library: readonly LibraryIdentity[],
): LibraryMatch | null {
  if (file.ccliNumber) {
    const byCcli = library.find((s) => s.ccliNumber === file.ccliNumber);
    if (byCcli) return { songId: byCcli.id, title: byCcli.title, reason: "ccli" };
  }
  const key = titleKey(file.title);
  if (!key) return null;
  const byTitle = library.find(
    (s) => titleKey(s.title) === key && (!file.ccliNumber || !s.ccliNumber || s.ccliNumber === file.ccliNumber),
  );
  return byTitle ? { songId: byTitle.id, title: byTitle.title, reason: "title" } : null;
}
