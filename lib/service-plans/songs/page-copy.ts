/** Static page text, shared by each page and its loading state. */
export const SONGS_TITLE = "Song library";
export const SONGS_DESCRIPTION =
  "Every song your church sings, with keys, chord charts and files, and when you last sang it.";
export const IMPORT_TITLE = "Import songs";
export const IMPORT_DESCRIPTION =
  "Bring in songs from ChordPro, OnSong, SongSelect or a spreadsheet. A chart with the CCLI number of a song you already have is added to that song. You check every song before it's saved.";
export const SONG_SECTIONS = {
  details: "Song details",
  arrangements: "Arrangements",
  usage: "Where it's been used",
} as const;
export const ARRANGEMENTS_DESCRIPTION =
  "Each arrangement has its own key, order and chord chart. You choose one when you add the song to a plan.";
export const FILTER_LABELS = ["Search", "Key", "Tag", "Sung in the last 12 months"] as const;
