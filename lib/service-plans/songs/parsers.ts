/**
 * Reads song files churches already have: ChordPro, OnSong, SongSelect
 * downloads (.usr and the plain-text lyrics sheet) and CSV spreadsheets.
 *
 * Pure functions only, so the import review and the unit tests share them and
 * nothing here can write. Every parser returns the same `ParsedSong`; anything
 * it had to guess or drop is said in `warnings`, in plain words, so the review
 * step can show it before a song is saved.
 */

import type { ParsedSection, ParsedSong, SongFileFormat } from "@/lib/service-plans/songs/types";

export type ParseResult = {
  format: SongFileFormat | null;
  songs: ParsedSong[];
  /** About the file as a whole (an unreadable file, skipped CSV rows). */
  warnings: string[];
};

const LIMITS = { title: 200, author: 300, copyright: 500, text: 100_000, tag: 40, tags: 20, csvRows: 1000 };

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Own keys only: a header named "constructor" must not find Object's. */
function lookup<T>(map: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

function toLines(text: string): string[] {
  return text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
}

const SECTION_NAMES: Record<string, string> = {
  verse: "Verse",
  chorus: "Chorus",
  refrain: "Refrain",
  bridge: "Bridge",
  prechorus: "Pre-Chorus",
  postchorus: "Post-Chorus",
  intro: "Intro",
  outro: "Outro",
  tag: "Tag",
  ending: "Ending",
  interlude: "Interlude",
  instrumental: "Instrumental",
  coda: "Coda",
  vamp: "Vamp",
  turnaround: "Turnaround",
  hook: "Hook",
  breakdown: "Breakdown",
  solo: "Solo",
  misc: "Misc",
};

const SECTION_ABBREVIATIONS: Record<string, string> = {
  v: "Verse",
  c: "Chorus",
  ch: "Chorus",
  r: "Refrain",
  b: "Bridge",
  br: "Bridge",
  pc: "Pre-Chorus",
  pre: "Pre-Chorus",
  i: "Intro",
  in: "Intro",
  o: "Outro",
  t: "Tag",
  e: "Ending",
  end: "Ending",
  int: "Interlude",
};

const SECTION_LABEL = new RegExp(
  `^(${Object.keys(SECTION_NAMES).join("|").replace("prechorus", "pre-?\\s?chorus").replace("postchorus", "post-?\\s?chorus")})(?:\\s*(\\d{1,2}[a-z]?))?\\s*:?\\s*$`,
  "i",
);
const SHORT_LABEL = /^(pc|pre|ch|br|int|end|in|v|c|r|b|i|o|t|e)(\d{0,2})\s*:$/i;

function nameFromWord(word: string, number: string | undefined): string {
  const base = lookup(SECTION_NAMES, word.toLowerCase().replace(/[^a-z]/g, "")) ?? word;
  return number ? `${base} ${number.toUpperCase()}` : base;
}

/** "Verse 1", "CHORUS:", "pre-chorus", "V2:" → a section name; else null. */
export function sectionLabel(line: string): string | null {
  const text = line.trim().replace(/^\*+|\*+$/g, "").trim();
  if (!text || text.length > 24) return null;
  const full = SECTION_LABEL.exec(text);
  if (full) return nameFromWord(full[1], full[2]);
  const short = SHORT_LABEL.exec(text);
  const word = short ? lookup(SECTION_ABBREVIATIONS, short[1].toLowerCase()) : undefined;
  if (short && word) return nameFromWord(word, short[2] || undefined);
  return null;
}

/** "V1", "C", "PC", "Bridge", "Verse 2" in a flow list → a section name. */
function flowName(token: string): string | null {
  const text = token.trim();
  if (!text) return null;
  const label = sectionLabel(text);
  if (label) return label;
  const short = /^([a-z]{1,3})(\d{0,2})$/i.exec(text);
  const word = short ? lookup(SECTION_ABBREVIATIONS, short[1].toLowerCase()) : undefined;
  if (short && word) return nameFromWord(word, short[2] || undefined);
  return null;
}

const CHORD =
  /^\(?[A-G](?:#|b)?(?:maj|min|m|M|dim|aug|sus|add|\+|°|ø)?\d*(?:(?:sus|add|maj|b|#|-)\d+)*(?:\/[A-G](?:#|b)?)?\)?$/;
const CHORD_FILLER = /^(\||\|\||-+|\/|%|x\d+|\(x\d+\)|n\.?c\.?|\.+)$/i;

/** A line of chords only, written above the lyrics they belong to. */
export function isChordLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  let chords = 0;
  for (const token of tokens) {
    if (CHORD_FILLER.test(token)) continue;
    if (!CHORD.test(token)) return false;
    chords += 1;
  }
  return chords > 0;
}

function hasInlineChords(line: string): boolean {
  return /\[[^\]\n]{1,12}\]/.test(line);
}

/** "Ama[G]zing [D/F#]grace" → "Amazing grace". */
export function stripChords(line: string): string {
  return line
    .replace(/\[[^\]\n]{1,12}\]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function fileTitle(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  return base.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
}

function joinAuthors(value: string): string {
  return value
    .split(/\s*\|\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");
}

function splitList(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of value.split(/\s*(?:[;,|]|\/t)\s*/)) {
    const tag = part.trim().slice(0, LIMITS.tag);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
    if (out.length >= LIMITS.tags) break;
  }
  return out;
}

/** "G", "g major", "E minor", "Bb", "F♯m" → "G", "G", "Em", "Bb", "F#m". */
export function normalizeKey(raw: string | null | undefined, warnings: string[]): string | null {
  if (!raw) return null;
  const text = raw
    .trim()
    .replace(/^key\s*[:-]?\s*/i, "")
    .replace(/♯/g, "#")
    .replace(/♭/g, "b")
    .split(/\s*(?:\/t|,|\||\/\s)\s*/)[0]
    .trim();
  if (!text) return null;
  const match = /^([A-Ga-g])\s*(#|b)?\s*(maj(?:or)?|min(?:or)?|m)?$/.exec(text);
  if (!match) {
    warnings.push(`The key "${raw.trim().slice(0, 20)}" wasn't recognised, so it was left blank.`);
    return null;
  }
  const minor = match[3] ? /^m(in|$)/i.test(match[3]) && !/^maj/i.test(match[3]) : false;
  return `${match[1].toUpperCase()}${match[2] ?? ""}${minor ? "m" : ""}`;
}

/** "CCLI# 4768151" → "4768151". */
export function normalizeCcli(raw: string | null | undefined, warnings: string[]): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, "");
  if (/^[0-9]{1,10}$/.test(digits)) return digits;
  if (raw.trim()) warnings.push(`The CCLI number "${raw.trim().slice(0, 20)}" isn't a number, so it was left blank.`);
  return null;
}

export function normalizeTempo(raw: string | number | null | undefined, warnings: string[]): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const match = /\d+(?:\.\d+)?/.exec(String(raw));
  const value = match ? Math.round(Number(match[0])) : NaN;
  if (Number.isFinite(value) && value >= 20 && value <= 300) return value;
  warnings.push(`The tempo "${String(raw).trim().slice(0, 20)}" isn't between 20 and 300 BPM, so it was left blank.`);
  return null;
}

function clip(value: string | null | undefined, max: number, what: string, warnings: string[]): string | null {
  const text = value?.trim();
  if (!text) return null;
  if (text.length <= max) return text;
  warnings.push(`The ${what} was longer than ${max.toLocaleString("en-US")} characters and was shortened.`);
  return text.slice(0, max);
}

type Meta = {
  title?: string;
  subtitle?: string;
  author?: string;
  ccli?: string;
  copyright?: string;
  key?: string;
  tempo?: string;
  tags?: string[];
  themes?: string[];
  flow?: string[];
};

function addAuthor(meta: Meta, value: string) {
  const name = joinAuthors(value);
  if (!name) return;
  meta.author = meta.author ? `${meta.author}, ${name}` : name;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

type Draft = { name: string; lyrics: string[]; chart: string[]; implicit: boolean; block: boolean };

/** Collects sections line by line, the same way for every text format. */
class SectionBuilder {
  private sections: Draft[] = [];
  private current: Draft | null = null;
  private order: string[] = [];
  private anyChords = false;
  private anyImplicit = false;
  private anyNamed = false;

  /** `block` sections (ChordPro start_of…) end only at their end_of…. */
  open(name: string, options: { implicit?: boolean; block?: boolean } = {}) {
    const draft: Draft = { name, lyrics: [], chart: [], implicit: Boolean(options.implicit), block: Boolean(options.block) };
    if (draft.implicit) this.anyImplicit = true;
    else this.anyNamed = true;
    this.sections.push(draft);
    this.current = draft;
    this.order.push(name);
  }

  close() {
    this.current = null;
  }

  /** "Sing the chorus again": in the order, but no new lyrics. */
  repeat(name: string | null) {
    const target = name ?? [...this.sections].reverse().find((s) => /^chorus|^refrain/i.test(s.name))?.name;
    if (target) this.order.push(target);
    this.current = null;
  }

  blank() {
    if (this.current && !this.current.block) this.current = null;
  }

  nextVerseName(): string {
    const used = new Set(this.sections.map((s) => s.name));
    let n = 1;
    while (used.has(`Verse ${n}`)) n += 1;
    return `Verse ${n}`;
  }

  line(raw: string) {
    const text = raw.replace(/\s+$/, "");
    if (!text.trim()) {
      this.blank();
      return;
    }
    if (!this.current) this.open(this.nextVerseName(), { implicit: true });
    const section = this.current!;
    if (isChordLine(text)) {
      this.anyChords = true;
      section.chart.push(text);
      return;
    }
    if (hasInlineChords(text)) this.anyChords = true;
    section.chart.push(text);
    const lyric = stripChords(text);
    if (lyric) section.lyrics.push(lyric);
  }

  finish(warnings: string[], flow?: string[]): { sections: ParsedSection[]; sectionOrder: string[]; chartText: string | null; lyrics: string | null } {
    // A label with nothing under it that repeats an earlier section ("Chorus"
    // again in OnSong) is a place in the order, not a new section.
    const kept: Draft[] = [];
    for (const s of this.sections) {
      if (s.chart.length === 0 && s.lyrics.length === 0) continue;
      const same = kept.find((k) => k.name === s.name);
      // The same words written out again: a repeat, already in the order.
      if (same && same.chart.join("\n") === s.chart.join("\n")) continue;
      if (same) {
        // Two different sections with one name: number the later one.
        let n = 2;
        while (kept.some((k) => k.name === `${s.name} (${n})`)) n += 1;
        const renamed = `${s.name} (${n})`;
        const index = this.order.lastIndexOf(s.name);
        if (index !== -1) this.order[index] = renamed;
        s.name = renamed;
      }
      kept.push(s);
    }
    const names = new Set(kept.map((s) => s.name));
    let order = this.order.filter((name) => names.has(name));
    if (flow?.length) {
      const fromFlow = flow.filter((name) => names.has(name));
      if (fromFlow.length) order = fromFlow;
    }
    if (this.anyImplicit && !this.anyNamed && kept.length > 1) {
      warnings.push("The file has no section names, so each verse was numbered in order.");
    }
    const sections = kept.map((s) => ({ name: s.name, lines: s.lyrics }));
    const lyricText = kept
      .filter((s) => s.lyrics.length)
      .map((s) => `${s.name}\n${s.lyrics.join("\n")}`)
      .join("\n\n");
    const chartText = this.anyChords ? kept.map((s) => `${s.name}\n${s.chart.join("\n")}`).join("\n\n") : null;
    return { sections, sectionOrder: order, chartText, lyrics: lyricText || null };
  }
}

function buildSong(
  meta: Meta,
  body: ReturnType<SectionBuilder["finish"]>,
  fallbackTitle: string,
  warnings: string[],
  options: { expectLyrics?: boolean } = { expectLyrics: true },
): ParsedSong {
  let title = clip(meta.title, LIMITS.title, "title", warnings);
  if (!title) {
    title = fallbackTitle.slice(0, LIMITS.title) || "Untitled song";
    warnings.push("The file has no title, so the file name was used.");
  }
  const author = clip(meta.author ?? meta.subtitle, LIMITS.author, "author", warnings);
  const song: ParsedSong = {
    title,
    author,
    ccliNumber: normalizeCcli(meta.ccli, warnings),
    copyright: clip(meta.copyright, LIMITS.copyright, "copyright", warnings),
    key: normalizeKey(meta.key, warnings),
    tempo: normalizeTempo(meta.tempo, warnings),
    tags: meta.tags ?? [],
    themes: meta.themes ?? [],
    sections: body.sections,
    sectionOrder: body.sectionOrder,
    chartText: clip(body.chartText, LIMITS.text, "chord chart", warnings),
    lyrics: clip(body.lyrics, LIMITS.text, "lyrics", warnings),
    warnings,
  };
  if (options.expectLyrics && !song.lyrics && !song.chartText) {
    warnings.push("No lyrics were found in this file.");
  }
  return song;
}

// ---------------------------------------------------------------------------
// ChordPro
// ---------------------------------------------------------------------------

const DIRECTIVE = /^\{\s*([a-zA-Z_][\w-]*)\s*(?::\s*([\s\S]*?)|\s+([\s\S]*?))?\s*\}$/;

function directiveValue(match: RegExpExecArray): string {
  return (match[2] ?? match[3] ?? "").trim();
}

function labelAttribute(value: string): string | null {
  const attr = /label\s*=\s*"([^"]*)"/i.exec(value) ?? /label\s*=\s*'([^']*)'/i.exec(value);
  const text = (attr ? attr[1] : value).trim();
  return text ? (sectionLabel(text) ?? text.slice(0, 40)) : null;
}

/** Applies one metadata directive; false when the name is not metadata. */
function applyMetaDirective(meta: Meta, name: string, value: string): boolean {
  switch (name) {
    case "title":
    case "t":
      if (!meta.title) meta.title = value;
      return true;
    case "subtitle":
    case "st":
    case "su":
      if (!meta.subtitle) meta.subtitle = value;
      return true;
    case "artist":
    case "composer":
    case "lyricist":
    case "author":
    case "words":
    case "music":
      addAuthor(meta, value);
      return true;
    case "key":
      if (!meta.key) meta.key = value;
      return true;
    case "tempo":
    case "bpm":
      if (!meta.tempo) meta.tempo = value;
      return true;
    case "ccli":
    case "ccli_number":
    case "ccli_song":
    case "ccli_song_number":
    case "ccli_song_id":
    case "x_ccli":
    case "x_ccli_number":
      if (!meta.ccli) meta.ccli = value;
      return true;
    case "copyright":
      if (!meta.copyright) meta.copyright = value;
      return true;
    case "tags":
    case "keywords":
      meta.tags = splitList(value);
      return true;
    case "themes":
    case "topic":
    case "topics":
      meta.themes = splitList(value);
      return true;
    case "flow":
      meta.flow = parseFlow(value);
      return true;
    default:
      return false;
  }
}

/**
 * "CCLI Song # 1234567", "CCLI Song #1234567", "CCLI Song No. 1234567",
 * "CCLI Song Number: 1234567", optionally behind a "#" comment mark. Never
 * the church's own "CCLI License # …", which is not the song's number.
 *
 * SongSelect's ChordPro download format is not documented to us, so the
 * ChordPro reader accepts the number as a directive ({ccli: N},
 * {ccli_number: N}, {meta: ccli N}), in a comment directive, on a "#"
 * comment line, or as a footer line in the body.
 */
const CCLI_SONG_TEXT = /^#*\s*CCLI\s+Song\s*(?:#|No\.?|Number)?\s*:?\s*#?\s*(\d{1,10})\b/i;
const CCLI_LICENSE_TEXT = /^#*\s*CCLI\s+Licen[cs]e\b/i;

/** The song number from a "CCLI Song # 1234567" line, or null. */
export function ccliSongNumberFromLine(line: string): string | null {
  return CCLI_SONG_TEXT.exec(line.trim())?.[1] ?? null;
}

const SKIP_BLOCKS = new Set(["tab", "grid", "abc", "ly", "svg"]);
const BLOCK_ALIASES: Record<string, string> = { sov: "verse", soc: "chorus", sob: "bridge", sot: "tab", sog: "grid" };
const END_ALIASES = new Set(["eov", "eoc", "eob", "eot", "eog"]);

export function parseChordPro(text: string, fileName = "song.cho"): ParsedSong {
  const meta: Meta = {};
  const warnings: string[] = [];
  const builder = new SectionBuilder();
  let skipping = false;

  for (const raw of toLines(text)) {
    const line = raw.trim();
    const footerCcli = ccliSongNumberFromLine(line);
    if (footerCcli) {
      if (!meta.ccli) meta.ccli = footerCcli;
      continue;
    }
    if (line.startsWith("#") || CCLI_LICENSE_TEXT.test(line)) continue;
    // A footer copyright line ("© 2020 …") is a fact about the song, not words to sing.
    if (/^(?:©|\(c\)\s)/i.test(line)) {
      if (!meta.copyright) meta.copyright = line.replace(/^(?:©|\(c\))\s*/i, "").trim() || undefined;
      continue;
    }
    const directive = DIRECTIVE.exec(line);
    if (directive) {
      let name = directive[1].toLowerCase();
      let value = directiveValue(directive);
      if (name === "meta") {
        const [first, ...rest] = value.split(/\s+/);
        name = (first ?? "").toLowerCase().replace(/:$/, "");
        value = rest.join(" ");
      }
      const commentCcli = ccliSongNumberFromLine(value);
      if (commentCcli && ["comment", "c", "ci", "comment_italic", "cb", "comment_box", "highlight", "footer"].includes(name)) {
        if (!meta.ccli) meta.ccli = commentCcli;
        continue;
      }
      if (applyMetaDirective(meta, name, value)) continue;

      const startKind = lookup(BLOCK_ALIASES, name) ?? (name.startsWith("start_of_") ? name.slice(9) : null);
      if (startKind) {
        if (SKIP_BLOCKS.has(startKind)) {
          skipping = true;
          builder.close();
          continue;
        }
        const label = labelAttribute(value);
        const fallback =
          startKind === "verse" ? builder.nextVerseName() : startKind.charAt(0).toUpperCase() + startKind.slice(1);
        builder.open(label ?? (sectionLabel(fallback) ?? fallback), { block: true });
        continue;
      }
      if (name.startsWith("end_of_") || END_ALIASES.has(name)) {
        skipping = false;
        builder.close();
        continue;
      }
      if (["comment", "c", "ci", "comment_italic", "cb", "comment_box", "highlight"].includes(name)) {
        const label = sectionLabel(value);
        if (label && !skipping) builder.open(label);
        continue;
      }
      if (name === "chorus") {
        builder.repeat(value ? labelAttribute(value) : null);
        continue;
      }
      // Formatting and anything else ChordPro can say: not part of the song.
      continue;
    }
    if (skipping) continue;
    const label = !hasInlineChords(line) ? sectionLabel(line) : null;
    if (label) {
      builder.open(label);
      continue;
    }
    builder.line(raw);
  }

  return buildSong(meta, builder.finish(warnings, meta.flow), fileTitle(fileName), warnings);
}

// ---------------------------------------------------------------------------
// OnSong
// ---------------------------------------------------------------------------

const META_LINE = /^([A-Za-z©][A-Za-z #©.]{0,24}?)\s*:\s*(.*)$/;

type MetaField = keyof Meta | "ignore";

const ONSONG_META: Record<string, MetaField> = {
  title: "title",
  artist: "author",
  author: "author",
  authors: "author",
  by: "author",
  writer: "author",
  writers: "author",
  composer: "author",
  lyricist: "author",
  words: "author",
  wordsandmusic: "author",
  key: "key",
  originalkey: "key",
  tempo: "tempo",
  bpm: "tempo",
  ccli: "ccli",
  cclinumber: "ccli",
  cclisong: "ccli",
  cclisongnumber: "ccli",
  copyright: "copyright",
  "©": "copyright",
  flow: "flow",
  tags: "tags",
  keywords: "tags",
  themes: "themes",
  topics: "themes",
  capo: "ignore",
  time: "ignore",
  timesignature: "ignore",
  duration: "ignore",
  book: "ignore",
  number: "ignore",
  songnumber: "ignore",
  affiliation: "ignore",
  album: "ignore",
  year: "ignore",
  transpose: "ignore",
  midi: "ignore",
  midiindex: "ignore",
};

function metaField(name: string): MetaField | undefined {
  return lookup(ONSONG_META, name.toLowerCase().replace(/[^a-z©]/g, ""));
}

function applyMetaField(meta: Meta, field: MetaField, value: string) {
  switch (field) {
    case "ignore":
      return;
    case "author":
      addAuthor(meta, value);
      return;
    case "tags":
    case "themes":
      meta[field] = splitList(value);
      return;
    case "flow":
      meta.flow = parseFlow(value);
      return;
    default:
      if (!meta[field]) meta[field] = value.trim();
  }
}

function parseFlow(value: string): string[] {
  const tokens = value.includes(",") ? value.split(",") : value.split(/\s+/);
  return tokens.map(flowName).filter((name): name is string => Boolean(name));
}

export function parseOnSong(text: string, fileName = "song.onsong"): ParsedSong {
  const meta: Meta = {};
  const warnings: string[] = [];
  const builder = new SectionBuilder();
  let inHeader = true;
  let headerTextLines = 0;

  for (const raw of toLines(text)) {
    const line = raw.trim();
    if (inHeader) {
      if (!line) {
        if (meta.title) inHeader = false;
        continue;
      }
      const label = sectionLabel(line);
      if (label) {
        inHeader = false;
        builder.open(label);
        continue;
      }
      const metaLine = META_LINE.exec(line);
      const field = metaLine ? metaField(metaLine[1]) : undefined;
      if (metaLine && field) {
        applyMetaField(meta, field, metaLine[2]);
        continue;
      }
      const directive = DIRECTIVE.exec(line);
      if (directive && applyMetaDirective(meta, directive[1].toLowerCase(), directiveValue(directive))) continue;
      if (!isChordLine(line) && !hasInlineChords(line)) {
        if (!meta.title) {
          meta.title = line;
          headerTextLines = 1;
          continue;
        }
        if (!meta.author && headerTextLines === 1) {
          addAuthor(meta, line);
          headerTextLines = 2;
          continue;
        }
      }
      inHeader = false;
    }

    if (!line) {
      builder.blank();
      continue;
    }
    if (line.startsWith("#") || DIRECTIVE.test(line)) continue;
    const label = !hasInlineChords(line) ? sectionLabel(line) : null;
    if (label) {
      builder.open(label);
      continue;
    }
    builder.line(raw);
  }

  return buildSong(meta, builder.finish(warnings, meta.flow), fileTitle(fileName), warnings);
}

// ---------------------------------------------------------------------------
// SongSelect
// ---------------------------------------------------------------------------

/** SongSelect's .usr download: INI-like, `/t` between fields, `/n` between lines. */
export function parseSongSelectUsr(text: string, fileName = "song.usr"): ParsedSong {
  const meta: Meta = {};
  const warnings: string[] = [];
  const builder = new SectionBuilder();
  let fields: string[] = [];
  let words: string[] = [];

  for (const raw of toLines(text)) {
    const line = raw.trim();
    const header = /^\[S\s+A?(\d{1,10})\]$/i.exec(line);
    if (header) {
      meta.ccli = header[1];
      continue;
    }
    const pair = /^([A-Za-z]+)=(.*)$/.exec(line);
    if (!pair) continue;
    const value = pair[2];
    switch (pair[1].toLowerCase()) {
      case "title":
        meta.title = value.trim();
        break;
      case "author":
        addAuthor(meta, value);
        break;
      case "copyright":
        meta.copyright = value.replace(/\s*\|\s*/g, "; ").trim();
        break;
      case "themes":
        meta.themes = splitList(value);
        break;
      case "keys":
      case "key":
        meta.key = value.split("/t")[0];
        break;
      case "tempo":
        meta.tempo = value;
        break;
      case "ccli":
      case "cclisongnumber":
        meta.ccli = meta.ccli ?? value;
        break;
      case "fields":
        fields = value.split("/t");
        break;
      case "words":
        words = value.split("/t");
        break;
    }
  }

  words.forEach((block, i) => {
    const field = fields[i]?.trim() ?? "";
    const name = sectionLabel(field) ?? (field ? field.slice(0, 40) : builder.nextVerseName());
    builder.open(name, { block: true });
    for (const line of block.split("/n")) builder.line(line);
    builder.close();
  });

  return buildSong(meta, builder.finish(warnings), fileTitle(fileName), warnings);
}

const CCLI_SONG_LINE = /^CCLI\s+Song\s*(?:#|No\.?|Number)\s*:?\s*(\d{1,10})/i;

/**
 * SongSelect's lyrics sheet as text: title, section names and lyrics, then a
 * footer with "CCLI Song # …", the writers, the copyright and the church's
 * own "CCLI License # …" (which is not the song's number).
 */
export function parseSongSelectText(text: string, fileName = "song.txt"): ParsedSong {
  const meta: Meta = {};
  const warnings: string[] = [];
  const builder = new SectionBuilder();
  const lines = toLines(text);
  const footerAt = lines.findIndex((l) => CCLI_SONG_LINE.test(l.trim()));
  const body = footerAt >= 0 ? lines.slice(0, footerAt) : lines;
  const footer = footerAt >= 0 ? lines.slice(footerAt) : [];

  if (footer.length) {
    meta.ccli = CCLI_SONG_LINE.exec(footer[0].trim())?.[1];
    for (const raw of footer.slice(1)) {
      const line = raw.trim();
      if (!line) continue;
      if (/^CCLI\s+Licen[cs]e/i.test(line)) continue;
      if (/^For use solely/i.test(line) || /www\.ccli\.com/i.test(line) || /^Note:/i.test(line)) continue;
      if (/^(©|\(c\)|copyright)/i.test(line) || /public domain/i.test(line)) {
        meta.copyright = meta.copyright ? `${meta.copyright}; ${line}` : line;
        continue;
      }
      if (!meta.author) addAuthor(meta, line);
    }
  }

  let seenSection = false;
  for (const raw of body) {
    const line = raw.trim();
    if (!meta.title) {
      if (line) meta.title = line;
      continue;
    }
    const label = !hasInlineChords(line) ? sectionLabel(line) : null;
    if (label) {
      seenSection = true;
      builder.open(label);
      continue;
    }
    if (!seenSection && line) {
      const key = /\bKey\s*[-:]\s*([A-G][#b]?m?)\b/.exec(line);
      const tempo = /\bTempo\s*[-:]\s*(\d{2,3})\b/i.exec(line);
      if (key || tempo) {
        if (key && !meta.key) meta.key = key[1];
        if (tempo && !meta.tempo) meta.tempo = tempo[1];
        continue;
      }
      const by = /^(?:words\s+and\s+music\s+by|words\s+by|music\s+by|by)\s*:?\s+(.+)$/i.exec(line);
      if (by) {
        if (!meta.author) addAuthor(meta, by[1]);
        continue;
      }
    }
    if (!line) {
      builder.blank();
      continue;
    }
    builder.line(raw);
  }

  if (!meta.ccli) warnings.push("No CCLI song number was found at the end of the file.");
  return buildSong(meta, builder.finish(warnings), fileTitle(fileName), warnings);
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** RFC 4180 records: quoted fields may hold commas, quotes ("") and newlines. */
export function parseCsvRecords(text: string): string[][] {
  const source = text.replace(/^﻿/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const delimiter = [",", ";", "\t"].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ",");

  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else if (ch === "\r") {
        field += "\n";
        if (source[i + 1] === "\n") i += 1;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === delimiter) {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || record.length) {
    record.push(field);
    records.push(record);
  }
  return records;
}

type CsvColumn = "title" | "author" | "ccli" | "key" | "tempo" | "tags" | "themes" | "copyright";

const CSV_HEADERS: Record<string, CsvColumn> = {
  title: "title",
  song: "title",
  songtitle: "title",
  songname: "title",
  name: "title",
  author: "author",
  authors: "author",
  artist: "author",
  writer: "author",
  writers: "author",
  songwriter: "author",
  songwriters: "author",
  ccli: "ccli",
  cclinumber: "ccli",
  cclino: "ccli",
  cclisong: "ccli",
  cclisongnumber: "ccli",
  ccliid: "ccli",
  key: "key",
  defaultkey: "key",
  tempo: "tempo",
  bpm: "tempo",
  tags: "tags",
  tag: "tags",
  category: "tags",
  categories: "tags",
  themes: "themes",
  theme: "themes",
  copyright: "copyright",
};

export function parseCsv(text: string): { songs: ParsedSong[]; warnings: string[] } {
  const warnings: string[] = [];
  const records = parseCsvRecords(text).filter((r) => r.some((cell) => cell.trim()));
  if (!records.length) return { songs: [], warnings: ["This spreadsheet is empty."] };

  const columns = new Map<CsvColumn, number>();
  records[0].forEach((cell, i) => {
    const column = lookup(CSV_HEADERS, cell.toLowerCase().replace(/[^a-z]/g, ""));
    if (column && !columns.has(column)) columns.set(column, i);
  });
  if (!columns.has("title")) {
    return {
      songs: [],
      warnings: ["This spreadsheet has no Title column. The first row should name the columns: Title, Author, CCLI, Key, Tempo, Tags."],
    };
  }

  const cell = (row: string[], column: CsvColumn) => {
    const i = columns.get(column);
    return i === undefined ? "" : (row[i] ?? "").trim();
  };

  const songs: ParsedSong[] = [];
  const rows = records.slice(1);
  if (rows.length > LIMITS.csvRows) {
    warnings.push(`Only the first ${LIMITS.csvRows.toLocaleString("en-US")} rows were read.`);
  }
  rows.slice(0, LIMITS.csvRows).forEach((row, i) => {
    const rowNumber = i + 2;
    const title = cell(row, "title");
    if (!title) {
      warnings.push(`Row ${rowNumber} has no title and was skipped.`);
      return;
    }
    const songWarnings: string[] = [];
    const meta: Meta = {
      title,
      author: cell(row, "author") || undefined,
      ccli: cell(row, "ccli") || undefined,
      key: cell(row, "key") || undefined,
      tempo: cell(row, "tempo") || undefined,
      copyright: cell(row, "copyright") || undefined,
      tags: splitList(cell(row, "tags")),
      themes: splitList(cell(row, "themes")),
    };
    const empty = { sections: [], sectionOrder: [], chartText: null, lyrics: null };
    songs.push(buildSong(meta, empty, title, songWarnings, { expectLyrics: false }));
  });
  return { songs, warnings };
}

// ---------------------------------------------------------------------------
// Detection and dispatch
// ---------------------------------------------------------------------------

const CHORDPRO_EXTENSIONS = new Set(["cho", "chordpro", "chopro", "crd", "pro"]);
const TEXT_EXTENSIONS = new Set(["txt", "text"]);

function extensionOf(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function looksLikeUsr(text: string): boolean {
  return /^\[S\s+A?\d+\]/m.test(text) || /^Words=/m.test(text);
}

/** Which parser reads this file, or null when FaithForm can't read it. */
export function detectFormat(fileName: string, text: string): SongFileFormat | null {
  const ext = extensionOf(fileName);
  if (CHORDPRO_EXTENSIONS.has(ext)) return "chordpro";
  if (ext === "onsong") return "onsong";
  if (ext === "usr") return "songselect";
  if (ext === "csv" || ext === "tsv") return "csv";
  if (!TEXT_EXTENSIONS.has(ext) && ext !== "") return null;
  if (/^\s*\{\s*(title|t)\s*:/im.test(text)) return "chordpro";
  if (looksLikeUsr(text)) return "songselect";
  if (/^\s*CCLI\s+Song\s*(#|No\.?|Number)/im.test(text)) return "songselect";
  return "onsong";
}

export const SUPPORTED_EXTENSIONS = [".cho", ".chordpro", ".chopro", ".crd", ".pro", ".onsong", ".usr", ".txt", ".csv", ".tsv"];

export function parseSongFile(fileName: string, text: string): ParseResult {
  const format = detectFormat(fileName, text);
  if (!format) {
    return {
      format: null,
      songs: [],
      warnings: ["FaithForm can't read this kind of file. Use ChordPro, OnSong, SongSelect (.usr or lyrics .txt) or a CSV spreadsheet."],
    };
  }
  if (!text.trim()) return { format, songs: [], warnings: ["This file is empty."] };
  switch (format) {
    case "chordpro":
      return { format, songs: [parseChordPro(text, fileName)], warnings: [] };
    case "onsong":
      return { format, songs: [parseOnSong(text, fileName)], warnings: [] };
    case "songselect":
      return {
        format,
        songs: [looksLikeUsr(text) ? parseSongSelectUsr(text, fileName) : parseSongSelectText(text, fileName)],
        warnings: [],
      };
    case "csv": {
      const { songs, warnings } = parseCsv(text);
      return { format, songs, warnings };
    }
  }
}
