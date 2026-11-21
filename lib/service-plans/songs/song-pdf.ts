import "server-only";

import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { createElement, type ReactElement } from "react";

import { SongPdfDocument } from "@/components/service-plans/pdf/song-pdf";
import { isChordLine, sectionLabel, stripChords } from "@/lib/service-plans/songs/parsers";
import type { GeneratedSongFile } from "@/lib/service-plans/songs/types";

/**
 * The lyrics and chord chart PDFs made from an arrangement each time it is
 * saved. Parsing is pure (and unit tested); rendering uses the plan PDF's
 * Montserrat fonts.
 *
 * Chart text is the Song Library's own format: chords in square brackets
 * before the syllable they fall on ("[G]Amazing grace, how [C]sweet"), or a
 * line of chords only above the words, with section names ("Verse 1") on
 * their own line.
 */

/** A chord and the words sung from it, up to the next chord. */
export type ChartSegment = { chord: string | null; text: string };

export type ChartLine =
  | { kind: "section"; text: string }
  /** A line of chords only: printed as written, in bold. */
  | { kind: "chords"; text: string }
  /** Words; segments carry a chord when the line had inline chords. */
  | { kind: "lyric"; segments: ChartSegment[] }
  | { kind: "blank" };

const INLINE_CHORD = /\[([^\]\n]{1,12})\]/g;

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

export function parseChartLines(chart: string): ChartLine[] {
  const lines: ChartLine[] = [];
  for (const raw of chart.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      if (lines.length && lines[lines.length - 1].kind !== "blank") lines.push({ kind: "blank" });
      continue;
    }
    const heading = sectionHeading(line);
    if (heading) {
      lines.push({ kind: "section", text: heading });
    } else if (isChordLine(line)) {
      lines.push({ kind: "chords", text: line.trim().replace(/\s{2,}/g, "   ") });
    } else {
      lines.push({ kind: "lyric", segments: chartSegments(line.trim()) });
    }
  }
  while (lines.length && lines[lines.length - 1].kind === "blank") lines.pop();
  return lines;
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
    if (isChordLine(raw)) continue;
    const words = stripChords(raw);
    if (words) out.push(words);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  // Section names alone are not lyrics.
  return out.some((line) => line && !sectionHeading(line)) ? out.join("\n") : null;
}

/** The text each generated PDF is made from; null when there is nothing to print. */
export function songPdfSources(arrangement: {
  chartText: string | null;
  lyrics: string | null;
}): Record<GeneratedSongFile, string | null> {
  const chart = arrangement.chartText?.trim() ? arrangement.chartText : null;
  const lyrics = arrangement.lyrics?.trim() ? arrangement.lyrics : chart ? lyricsFromChart(chart) : null;
  const chartHasContent = chart ? parseChartLines(chart).some((l) => l.kind === "lyric" || l.kind === "chords") : false;
  const lyricsHaveContent = lyrics ? parseLyricLines(lyrics).some((l) => l.kind === "text") : false;
  return { chart: chartHasContent ? chart : null, lyrics: lyricsHaveContent ? lyrics : null };
}

export type SongPdfSong = {
  title: string;
  author: string | null;
  ccliNumber: string | null;
  copyright: string | null;
};

export type SongPdfArrangement = {
  name: string;
  key: string | null;
  bpm: number | null;
};

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

const FILE_SUFFIX: Record<GeneratedSongFile, string> = { lyrics: "lyrics", chart: "chord-chart" };

/** `amazing-grace-default-lyrics.pdf`, `amazing-grace-default-chord-chart.pdf` */
export function songPdfFileName(title: string, arrangementName: string, kind: GeneratedSongFile): string {
  const parts = [slug(title) || "song", slug(arrangementName), FILE_SUFFIX[kind]];
  return `${parts.filter(Boolean).join("-")}.pdf`;
}

export async function renderSongPdf(input: {
  kind: GeneratedSongFile;
  song: SongPdfSong;
  arrangement: SongPdfArrangement;
  /** The chart text for "chart", the lyrics for "lyrics" (see `songPdfSources`). */
  text: string;
}): Promise<Buffer> {
  const element = createElement(SongPdfDocument, {
    song: input.song,
    arrangement: input.arrangement,
    content:
      input.kind === "chart"
        ? { kind: "chart", lines: parseChartLines(input.text) }
        : { kind: "lyrics", lines: parseLyricLines(input.text) },
  }) as unknown as ReactElement<DocumentProps>;
  return renderToBuffer(element);
}
