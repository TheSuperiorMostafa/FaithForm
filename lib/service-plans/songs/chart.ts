/**
 * Reads a chord chart into lines a renderer can lay out with each chord
 * directly above the syllable where it changes.
 *
 * Pure (no server-only imports), so the song editor's live preview, the share
 * page and the chart PDF all read a chart the same way.
 *
 * The stored text is the Song Library's own format and stays as written:
 * chords in square brackets before the syllable they fall on
 * ("[G]Amazing grace, how [C]sweet"), or a line of chords only above the
 * words, with section names ("Verse 1") on their own line. A chord line that
 * sits directly above a line of words is merged with it by column, so both
 * styles come out as the same chord-over-word segments.
 */

import { isChordLine, sectionLabel, stripChords } from "@/lib/service-plans/songs/parsers";

/** A chord and the words sung from it, up to the next chord. */
export type ChartSegment = { chord: string | null; text: string };

export type ChartLine =
  | { kind: "section"; text: string }
  /** A line of chords with no words under it (an intro or turnaround). */
  | { kind: "chords"; text: string }
  /** Words; segments carry a chord where one changes. */
  | { kind: "lyric"; segments: ChartSegment[] }
  | { kind: "blank" };

const INLINE_CHORD = /\[([^\]\n]{1,12})\]/g;
const DIRECTIVE = /^\{\s*([a-zA-Z_][\w-]*)\s*(?::\s*([\s\S]*?)|\s+([\s\S]*?))?\s*\}$/;

/** "Verse 1", "CHORUS:", and the "Chorus (2)" the importer gives a second chorus. */
export function sectionHeading(line: string): string | null {
  const text = line.trim();
  const label = sectionLabel(text);
  if (label) return label;
  const numbered = /^(.+?)\s*\((\d{1,2})\)$/.exec(text);
  const base = numbered ? sectionLabel(numbered[1]) : null;
  return base ? `${base} (${numbered![2]})` : null;
}

/** "Ama[G]zing [D/F#]grace" → [{null,"Ama"}, {"G","zing "}, {"D/F#","grace"}]. */
export function chartSegments(line: string): ChartSegment[] {
  const segments: ChartSegment[] = [];
  let last = 0;
  let chord: string | null = null;
  for (const match of line.matchAll(INLINE_CHORD)) {
    const text = line.slice(last, match.index);
    if (chord !== null || text) segments.push({ chord, text });
    chord = match[1].trim();
    last = match.index + match[0].length;
  }
  const rest = line.slice(last);
  if (chord !== null || rest || !segments.length) segments.push({ chord, text: rest });
  return segments;
}

function expandTabs(line: string): string {
  return line.replace(/\t/g, "    ");
}

/** Each chord on a chord-only line with the column it starts at. */
function chordColumns(line: string): { column: number; chord: string }[] {
  const out: { column: number; chord: string }[] = [];
  for (const match of expandTabs(line).matchAll(/\S+/g)) out.push({ column: match.index, chord: match[0] });
  return out;
}

/**
 * A chord line written above a line of words, merged by column:
 *
 *     G           C       G
 *     Amazing grace, how sweet the sound
 *
 * becomes [{G,"Amazing grace, "}, …]. A chord past the end of the words gets
 * an empty segment, so it still prints in place.
 */
export function mergeChordLine(chordLine: string, lyricLine: string): ChartSegment[] {
  const chords = chordColumns(chordLine);
  let words = expandTabs(lyricLine).replace(/\s+$/, "");
  if (!chords.length) return [{ chord: null, text: words.trim() }];
  // Indentation both lines share is not part of the song.
  const indent = Math.min(chords[0].column, /^\s*/.exec(words)![0].length);
  words = words.slice(indent);
  const columns = chords.map((c) => ({ ...c, column: c.column - indent }));

  const segments: ChartSegment[] = [];
  if (columns[0].column > 0) {
    const lead = words.slice(0, columns[0].column);
    if (lead) segments.push({ chord: null, text: lead });
  }
  columns.forEach((c, i) => {
    const end = i + 1 < columns.length ? columns[i + 1].column : words.length;
    segments.push({ chord: c.chord, text: c.column < words.length ? words.slice(c.column, Math.max(end, c.column)) : "" });
  });
  return segments;
}

function isLyricText(line: string): boolean {
  return Boolean(line.trim()) && !sectionHeading(line) && !isChordLine(line) && !DIRECTIVE.test(line.trim());
}

/** ChordPro section directives a person may type into the chart box. */
function directiveHeading(name: string, value: string): string | null {
  const start = name.startsWith("start_of_") ? name.slice(9) : ({ soc: "chorus", sov: "verse", sob: "bridge" } as Record<string, string>)[name];
  if (start) {
    const label = /label\s*=\s*"([^"]*)"/i.exec(value)?.[1] ?? value;
    const text = label.trim() || start.charAt(0).toUpperCase() + start.slice(1);
    return sectionHeading(text) ?? text.slice(0, 40);
  }
  if (["comment", "c", "ci", "cb", "comment_italic", "comment_box", "highlight"].includes(name)) {
    return sectionHeading(value) ?? (value.trim() ? value.trim().slice(0, 80) : null);
  }
  return null;
}

export function parseChartLines(chart: string): ChartLine[] {
  const lines: ChartLine[] = [];
  const raws = chart.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < raws.length; i += 1) {
    const line = raws[i].replace(/\s+$/, "");
    if (!line.trim()) {
      if (lines.length && lines[lines.length - 1].kind !== "blank") lines.push({ kind: "blank" });
      continue;
    }
    const directive = DIRECTIVE.exec(line.trim());
    if (directive) {
      const heading = directiveHeading(directive[1].toLowerCase(), (directive[2] ?? directive[3] ?? "").trim());
      if (heading) lines.push({ kind: "section", text: heading });
      continue;
    }
    const heading = sectionHeading(line);
    if (heading) {
      lines.push({ kind: "section", text: heading });
    } else if (isChordLine(line)) {
      const next = raws[i + 1];
      if (next !== undefined && isLyricText(next) && !/\[[^\]\n]{1,12}\]/.test(next)) {
        lines.push({ kind: "lyric", segments: mergeChordLine(line, next) });
        i += 1;
      } else {
        lines.push({ kind: "chords", text: line.trim().replace(/\s{2,}/g, "   ") });
      }
    } else {
      lines.push({ kind: "lyric", segments: chartSegments(line.trim()) });
    }
  }
  while (lines.length && lines[lines.length - 1].kind === "blank") lines.pop();
  return lines;
}

/** One word with the chord that starts on it, so a long line wraps between words. */
export type ChartUnit = { chord: string | null; word: string; space: boolean };

/** Splits segments into words; a chord stays on the first word of its segment. */
export function chartUnits(segments: ChartSegment[]): ChartUnit[] {
  const out: ChartUnit[] = [];
  for (const segment of segments) {
    const tokens = segment.text.match(/\S+\s*|\s+/g) ?? [""];
    tokens.forEach((token, i) => {
      const word = token.trimEnd();
      out.push({ chord: i === 0 ? segment.chord : null, word, space: word !== token });
    });
  }
  return out;
}

export type LyricLine = { kind: "section"; text: string } | { kind: "text"; text: string } | { kind: "blank" };

export function parseLyricLines(lyrics: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lyrics.replace(/\r\n?/g, "\n").split("\n")) {
    const text = raw.trim();
    if (!text) {
      if (lines.length && lines[lines.length - 1].kind !== "blank") lines.push({ kind: "blank" });
      continue;
    }
    const heading = sectionHeading(text);
    lines.push(heading ? { kind: "section", text: heading } : { kind: "text", text });
  }
  while (lines.length && lines[lines.length - 1].kind === "blank") lines.pop();
  return lines;
}

/** Words only, from a chord chart: chord lines dropped, inline chords removed. */
export function lyricsFromChart(chart: string): string | null {
  const out: string[] = [];
  for (const raw of chart.replace(/\r\n?/g, "\n").split("\n")) {
    if (!raw.trim()) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }
    if (sectionHeading(raw)) {
      out.push(raw.trim());
      continue;
    }
    if (isChordLine(raw) || DIRECTIVE.test(raw.trim())) continue;
    const words = stripChords(raw);
    if (words) out.push(words);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  // Section names alone are not lyrics.
  return out.some((line) => line && !sectionHeading(line)) ? out.join("\n") : null;
}

/** Whether a chart has anything to show beyond section names. */
export function chartHasContent(chart: string | null | undefined): boolean {
  return chart ? parseChartLines(chart).some((l) => l.kind === "lyric" || l.kind === "chords") : false;
}

export function lyricsHaveContent(lyrics: string | null | undefined): boolean {
  return lyrics ? parseLyricLines(lyrics).some((l) => l.kind === "text") : false;
}

/** "© 1779 John Newton", but "Public Domain" and "Copyright …" as written. */
export function copyrightLine(copyright: string): string {
  const text = copyright.trim();
  return /^(©|\(c\)|copyright\b|public domain\b)/i.test(text) ? text : `© ${text}`;
}

/**
 * The chart as it reads in the editor: each line with inline chords
 * ("[G]Morning [C]light") becomes a line of chords above its words, aligned
 * by column, so the editable chart looks like a printed one:
 *
 *     G       C
 *     Morning light
 *
 * Section names, directives, blank lines and lines already written as chords
 * over words are kept as they are. `toInlineChart` turns it back for storage.
 */
export function toChordsOverWords(chart: string): string {
  const raws = chart.replace(/\r\n?/g, "\n").split("\n");
  return raws
    .map((line, index) => {
      if (!/\[[^\]\n]{1,12}\]/.test(line) || DIRECTIVE.test(line.trim())) return line;
      // A chords-only line sitting right above plain words would read as that
      // line's chords once the brackets go, so it keeps them.
      const next = raws[index + 1];
      if (!stripChords(line).trim() && next !== undefined && isLyricText(next) && !/\[[^\]\n]{1,12}\]/.test(next)) {
        return line;
      }
      let chords = "";
      let words = "";
      for (const segment of chartSegments(line)) {
        if (segment.chord !== null) {
          // A chord starts where its words do, and never runs into the last one.
          const column = Math.max(words.length, chords.length ? chords.replace(/\s+$/, "").length + 1 : 0);
          words = words.padEnd(column, " ");
          chords = chords.padEnd(column, " ") + segment.chord;
        }
        words += segment.text;
      }
      words = words.replace(/\s+$/, "");
      return words.trim() ? `${chords}\n${words}` : chords;
    })
    .join("\n");
}

/**
 * Back to the stored format: a line of chords directly above a line of words
 * becomes one line with each chord in brackets before its syllable. Chord
 * lines with no words under them (an intro), section names and directives
 * are kept as written.
 */
export function toInlineChart(text: string): string {
  const raws = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < raws.length; i += 1) {
    const line = raws[i];
    const next = raws[i + 1];
    if (
      line.trim() &&
      !sectionHeading(line) &&
      !DIRECTIVE.test(line.trim()) &&
      isChordLine(line) &&
      next !== undefined &&
      isLyricText(next) &&
      !/\[[^\]\n]{1,12}\]/.test(next)
    ) {
      out.push(
        mergeChordLine(line, next)
          .map((s) => `${s.chord !== null ? `[${s.chord}]` : ""}${s.text}`)
          .join("")
          .replace(/\s+$/, ""),
      );
      i += 1;
    } else {
      out.push(line);
    }
  }
  return out.join("\n");
}
