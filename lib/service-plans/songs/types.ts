/**
 * Shapes shared by the Song Library screens, its server actions and the plan
 * screens' song picker. Database rows are mapped into these in `queries.ts`.
 */

export const SONG_SOURCES = ["manual", "chordpro", "onsong", "songselect", "csv", "starter"] as const;
export type SongSourceKind = (typeof SONG_SOURCES)[number];

export const SONG_FILE_FORMATS = ["chordpro", "onsong", "songselect", "csv"] as const;
export type SongFileFormat = (typeof SONG_FILE_FORMATS)[number];

export const SONG_FILE_FORMAT_LABELS: Record<SongFileFormat, string> = {
  chordpro: "ChordPro",
  onsong: "OnSong",
  songselect: "SongSelect",
  csv: "Spreadsheet",
};

/** Keys offered in pickers. Any short key typed or imported is still kept. */
export const COMMON_KEYS = [
  "C", "C#", "Db", "D", "Eb", "E", "F", "F#", "Gb", "G", "Ab", "A", "Bb", "B",
  "Cm", "C#m", "Dm", "Ebm", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "Bbm", "Bm",
] as const;

/** What the plan screens' song picker needs: one search hit. */
export type SongPickerOption = {
  id: string;
  title: string;
  author: string | null;
  ccliNumber: string | null;
  defaultKey: string | null;
  arrangements: { id: string; name: string; key: string | null; lengthSeconds: number | null }[];
};

export type SongListRow = {
  id: string;
  title: string;
  author: string | null;
  ccliNumber: string | null;
  defaultKey: string | null;
  tags: string[];
  /** Latest past (or today's) plan date the song was in, `YYYY-MM-DD`. */
  lastUsed: string | null;
  /** Next plan date on the calendar, when it is already scheduled. */
  nextScheduled: string | null;
  /** Plans in the last 12 months (up to today) that include it. */
  timesUsed12Months: number;
};

export type SongAttachmentKind = "chart_pdf" | "audio_link" | "file";

export type SongAttachment = {
  id: string;
  arrangementId: string;
  kind: SongAttachmentKind;
  /** File name, or the label given to a link. */
  name: string;
  /** For links only; files are opened through a short-lived signed URL. */
  url: string | null;
  isFile: boolean;
  createdAt: string;
};

export type SongArrangement = {
  id: string;
  name: string;
  key: string | null;
  bpm: number | null;
  lengthSeconds: number | null;
  sectionOrder: string[];
  chartText: string | null;
  lyrics: string | null;
  attachments: SongAttachment[];
};

export type SongUsage = {
  planId: string;
  serviceTypeId: string;
  serviceTypeName: string;
  date: string;
  planTitle: string | null;
  arrangementName: string | null;
  key: string | null;
};

export type SongDetail = {
  id: string;
  title: string;
  author: string | null;
  ccliNumber: string | null;
  copyright: string | null;
  defaultKey: string | null;
  tempo: number | null;
  tags: string[];
  themes: string[];
  source: SongSourceKind;
  arrangements: SongArrangement[];
  usage: SongUsage[];
};

export type UsageReportRow = {
  date: string;
  serviceType: string;
  planTitle: string | null;
  songTitle: string;
  author: string | null;
  ccliNumber: string | null;
  arrangement: string | null;
  key: string | null;
};

export type ParsedSection = { name: string; lines: string[] };

/** One song read from a file, before anyone has reviewed it. */
export type ParsedSong = {
  title: string;
  author: string | null;
  ccliNumber: string | null;
  copyright: string | null;
  key: string | null;
  tempo: number | null;
  tags: string[];
  themes: string[];
  /** Sections with their lyric lines (chords removed). */
  sections: ParsedSection[];
  /** The order the sections are sung in; defaults to the order in the file. */
  sectionOrder: string[];
  /** Sections with chords kept, or null when the file had no chords. */
  chartText: string | null;
  lyrics: string | null;
  warnings: string[];
};

/** A parsed song in the import review, with what it might duplicate. */
export type ImportPreviewSong = ParsedSong & {
  /** Stable within one preview, so the review can toggle rows. */
  previewId: string;
  fileName: string;
  format: SongFileFormat;
  duplicate: { songId: string | null; title: string; reason: "ccli" | "title"; inFile: boolean } | null;
};

/** What the review step sends back to be saved. */
export type ImportSongInput = Omit<ParsedSong, "warnings" | "sections"> & {
  format: SongFileFormat;
};
