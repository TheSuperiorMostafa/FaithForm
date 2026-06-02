/** Parse "John 3:16" or "John 3:16-18" into book/chapter/verses. */
export type ParsedRef = {
  bookName: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
};

const REF_RE =
  /^(.+?)\s+(\d+)(?::(\d+)(?:\s*[-–]\s*(\d+))?)?$/;

export function parseScriptureRef(ref: string): ParsedRef | null {
  const m = ref.trim().match(REF_RE);
  if (!m) return null;

  const bookName = m[1].trim();
  const chapter = Number(m[2]);
  const verseStart = m[3] ? Number(m[3]) : 1;
  const verseEnd = m[4] ? Number(m[4]) : verseStart;

  if (!bookName || !chapter || verseStart < 1 || verseEnd < verseStart) {
    return null;
  }

  return { bookName, chapter, verseStart, verseEnd };
}

export function buildScriptureRef(
  bookName: string,
  chapter: number,
  verseStart: number,
  verseEnd: number,
): string {
  if (verseStart === verseEnd) {
    return `${bookName} ${chapter}:${verseStart}`;
  }
  return `${bookName} ${chapter}:${verseStart}-${verseEnd}`;
}
