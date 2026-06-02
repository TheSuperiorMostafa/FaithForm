export type BibleBook = {
  name: string;
  testament: "OT" | "NT";
  chapters: number;
};

export const BIBLE_BOOKS: BibleBook[] = [
  { name: "Genesis", testament: "OT", chapters: 50 },
  { name: "Exodus", testament: "OT", chapters: 40 },
  { name: "Leviticus", testament: "OT", chapters: 27 },
  { name: "Numbers", testament: "OT", chapters: 36 },
  { name: "Deuteronomy", testament: "OT", chapters: 34 },
  { name: "Joshua", testament: "OT", chapters: 24 },
  { name: "Judges", testament: "OT", chapters: 21 },
  { name: "Ruth", testament: "OT", chapters: 4 },
  { name: "1 Samuel", testament: "OT", chapters: 31 },
  { name: "2 Samuel", testament: "OT", chapters: 24 },
  { name: "1 Kings", testament: "OT", chapters: 22 },
  { name: "2 Kings", testament: "OT", chapters: 25 },
  { name: "1 Chronicles", testament: "OT", chapters: 29 },
  { name: "2 Chronicles", testament: "OT", chapters: 36 },
  { name: "Ezra", testament: "OT", chapters: 10 },
  { name: "Nehemiah", testament: "OT", chapters: 13 },
  { name: "Esther", testament: "OT", chapters: 10 },
  { name: "Job", testament: "OT", chapters: 42 },
  { name: "Psalms", testament: "OT", chapters: 150 },
  { name: "Proverbs", testament: "OT", chapters: 31 },
  { name: "Ecclesiastes", testament: "OT", chapters: 12 },
  { name: "Song of Solomon", testament: "OT", chapters: 8 },
  { name: "Isaiah", testament: "OT", chapters: 66 },
  { name: "Jeremiah", testament: "OT", chapters: 52 },
  { name: "Lamentations", testament: "OT", chapters: 5 },
  { name: "Ezekiel", testament: "OT", chapters: 48 },
  { name: "Daniel", testament: "OT", chapters: 12 },
  { name: "Hosea", testament: "OT", chapters: 14 },
  { name: "Joel", testament: "OT", chapters: 3 },
  { name: "Amos", testament: "OT", chapters: 9 },
  { name: "Obadiah", testament: "OT", chapters: 1 },
  { name: "Jonah", testament: "OT", chapters: 4 },
  { name: "Micah", testament: "OT", chapters: 7 },
  { name: "Nahum", testament: "OT", chapters: 3 },
  { name: "Habakkuk", testament: "OT", chapters: 3 },
  { name: "Zephaniah", testament: "OT", chapters: 3 },
  { name: "Haggai", testament: "OT", chapters: 2 },
  { name: "Zechariah", testament: "OT", chapters: 14 },
  { name: "Malachi", testament: "OT", chapters: 4 },
  { name: "Matthew", testament: "NT", chapters: 28 },
  { name: "Mark", testament: "NT", chapters: 16 },
  { name: "Luke", testament: "NT", chapters: 24 },
  { name: "John", testament: "NT", chapters: 21 },
  { name: "Acts", testament: "NT", chapters: 28 },
  { name: "Romans", testament: "NT", chapters: 16 },
  { name: "1 Corinthians", testament: "NT", chapters: 16 },
  { name: "2 Corinthians", testament: "NT", chapters: 13 },
  { name: "Galatians", testament: "NT", chapters: 6 },
  { name: "Ephesians", testament: "NT", chapters: 6 },
  { name: "Philippians", testament: "NT", chapters: 4 },
  { name: "Colossians", testament: "NT", chapters: 4 },
  { name: "1 Thessalonians", testament: "NT", chapters: 5 },
  { name: "2 Thessalonians", testament: "NT", chapters: 3 },
  { name: "1 Timothy", testament: "NT", chapters: 6 },
  { name: "2 Timothy", testament: "NT", chapters: 4 },
  { name: "Titus", testament: "NT", chapters: 3 },
  { name: "Philemon", testament: "NT", chapters: 1 },
  { name: "Hebrews", testament: "NT", chapters: 13 },
  { name: "James", testament: "NT", chapters: 5 },
  { name: "1 Peter", testament: "NT", chapters: 5 },
  { name: "2 Peter", testament: "NT", chapters: 3 },
  { name: "1 John", testament: "NT", chapters: 5 },
  { name: "2 John", testament: "NT", chapters: 1 },
  { name: "3 John", testament: "NT", chapters: 1 },
  { name: "Jude", testament: "NT", chapters: 1 },
  { name: "Revelation", testament: "NT", chapters: 22 },
];

export function findBook(name: string): BibleBook | undefined {
  const lc = name.trim().toLowerCase();
  return BIBLE_BOOKS.find((b) => b.name.toLowerCase() === lc);
}

export function buildReference(
  book: string,
  chapter: number,
  verseStart?: number | null,
  verseEnd?: number | null,
): string {
  if (!book || !chapter) return "";
  if (!verseStart) return `${book} ${chapter}`;
  if (!verseEnd || verseEnd === verseStart) {
    return `${book} ${chapter}:${verseStart}`;
  }
  return `${book} ${chapter}:${verseStart}-${verseEnd}`;
}
