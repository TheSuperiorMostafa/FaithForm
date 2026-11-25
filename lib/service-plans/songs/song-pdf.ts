import "server-only";

import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { createElement, type ReactElement } from "react";

import { SongPdfDocument } from "@/components/service-plans/pdf/song-pdf";
import {
  chartHasContent,
  lyricsFromChart,
  lyricsHaveContent,
  parseChartLines,
  parseLyricLines,
} from "@/lib/service-plans/songs/chart";
import type { GeneratedSongFile } from "@/lib/service-plans/songs/types";

/**
 * The lyrics and chord chart PDFs made from an arrangement each time it is
 * saved (and on demand for share links). Parsing lives in `chart.ts` (pure,
 * unit tested, shared with the on-screen chart); rendering uses the plan
 * PDF's Montserrat fonts.
 */

export {
  chartSegments,
  lyricsFromChart,
  parseChartLines,
  parseLyricLines,
  sectionHeading,
  type ChartLine,
  type ChartSegment,
  type LyricLine,
} from "@/lib/service-plans/songs/chart";

/** The text each generated PDF is made from; null when there is nothing to print. */
export function songPdfSources(arrangement: {
  chartText: string | null;
  lyrics: string | null;
}): Record<GeneratedSongFile, string | null> {
  const chart = arrangement.chartText?.trim() ? arrangement.chartText : null;
  const lyrics = arrangement.lyrics?.trim() ? arrangement.lyrics : chart ? lyricsFromChart(chart) : null;
  return { chart: chartHasContent(chart) ? chart : null, lyrics: lyricsHaveContent(lyrics) ? lyrics : null };
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
