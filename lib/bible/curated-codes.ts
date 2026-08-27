/**
 * The file codes a curated translation may be stored under.
 *
 * Both the catalog (`lib/bible/translations.ts`) and the local-file probe
 * (`lib/bible/local-data.ts`) need this list, and the probe cannot import the
 * catalog — the catalog imports the probe. It used to be typed out in both
 * places, so a translation added to one and not the other was offered in the
 * dropdown while its file was never looked for. One list, imported twice.
 */
export const CURATED_TRANSLATION_FILE_CODES = [
  "KJV",
  "ESV",
  "NIV",
  "NLT",
  "CSB",
  "NKJV",
  "NASB",
  "NRSV",
] as const;
