import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import React from "react";

import { registerPlanPdfFonts } from "@/components/service-plans/pdf/plan-pdf";
import { chartUnits, copyrightLine, type ChartLine, type ChartSegment, type LyricLine } from "@/lib/service-plans/songs/chart";
import type { SongPdfArrangement, SongPdfSong } from "@/lib/service-plans/songs/song-pdf";

export { copyrightLine };

/**
 * A song's lyrics sheet or chord chart, made from the arrangement on save.
 * Same family as the printed plan: Montserrat, navy title, black-and-white
 * friendly (chords are bold, not only coloured). CCLI number and copyright
 * print on every page.
 *
 * Without a monospaced font, chords cannot line up by spaces. Every chord
 * (inline, or from a chord line above the words) is printed as a small
 * chord-over-word block in a wrapping row instead, so each chord sits over
 * the syllable where it changes.
 */

registerPlanPdfFonts();

const FONT = "Montserrat";
const NAVY = "#002D5F";
const GOLD = "#C5A059";
const INK = "#111827";
const MUTED = "#4B5563";
const RULE = "#9CA3AF";
const MARGIN = 40;
const FOOTER_HEIGHT = 30;
const LH = 1.35;

const LYRIC_SIZE = 11;
const CHORD_SIZE = 9.5;
const SHEET_SIZE = 12;

const styles = StyleSheet.create({
  page: {
    paddingTop: MARGIN,
    paddingHorizontal: MARGIN,
    paddingBottom: MARGIN + FOOTER_HEIGHT + 8,
    fontFamily: FONT,
    fontWeight: 400,
    fontSize: LYRIC_SIZE,
    // As in the plan PDF: no lineHeight on the page or a View, so the
    // page-number text renders; each Text sets fontSize with its lineHeight.
    color: INK,
    backgroundColor: "#FFFFFF",
  },
  label: { fontSize: 9, lineHeight: LH, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: 0.6 },
  title: { fontSize: 20, lineHeight: 1.25, fontWeight: 700, color: NAVY, marginTop: 2 },
  author: { fontSize: 10, lineHeight: LH, color: MUTED, marginTop: 2 },
  meta: { fontSize: 10, lineHeight: LH, fontWeight: 600, color: INK, marginTop: 3 },
  rule: { height: 2.5, marginTop: 10, marginBottom: 12, backgroundColor: GOLD },
  section: {
    fontSize: 10,
    lineHeight: LH,
    fontWeight: 700,
    color: NAVY,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 8,
    marginBottom: 2,
  },
  blank: { height: 8 },
  chordLine: { fontSize: CHORD_SIZE + 0.5, lineHeight: LH, fontWeight: 700, color: NAVY, marginTop: 2 },
  lyric: { fontSize: LYRIC_SIZE, lineHeight: LH },
  segmentRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", marginTop: 2 },
  chord: { fontSize: CHORD_SIZE, lineHeight: 1.2, fontWeight: 700, color: NAVY },
  // Keeps two chords on short syllables apart; a word without a chord takes no extra room.
  chordGap: { paddingRight: 3 },
  sheetLine: { fontSize: SHEET_SIZE, lineHeight: 1.45 },
  sheetSection: { fontSize: 10.5, marginTop: 10 },
  empty: { fontSize: 11, lineHeight: LH, color: MUTED },
  footer: {
    position: "absolute",
    left: MARGIN,
    right: MARGIN,
    bottom: MARGIN,
    height: FOOTER_HEIGHT,
    borderTopWidth: 0.75,
    borderTopColor: RULE,
    paddingTop: 5,
    paddingRight: 80,
  },
  footerLine: { fontSize: 8, lineHeight: LH, color: MUTED },
  footerCcli: { fontSize: 8, lineHeight: LH, fontWeight: 600, color: INK },
  // A dynamic `render` text needs its own fixed box to get a width.
  footerPage: {
    position: "absolute",
    right: MARGIN,
    bottom: MARGIN + FOOTER_HEIGHT - 16,
    width: 80,
    fontSize: 8,
    color: MUTED,
    textAlign: "right",
  },
});

const NBSP = " ";
const SPACE_WIDTH = LYRIC_SIZE * 0.3;

function ChartLyric({ segments }: { segments: ChartSegment[] }) {
  if (!segments.some((s) => s.chord)) {
    return <Text style={styles.lyric}>{segments.map((s) => s.text).join("")}</Text>;
  }
  return (
    <View style={styles.segmentRow} wrap={false}>
      {chartUnits(segments).map((unit, i) => (
        <View key={i} style={unit.space ? { marginRight: SPACE_WIDTH } : undefined}>
          <Text style={unit.chord ? [styles.chord, styles.chordGap] : styles.chord}>{unit.chord ?? NBSP}</Text>
          <Text style={styles.lyric}>{unit.word || NBSP}</Text>
        </View>
      ))}
    </View>
  );
}

function ChartBody({ lines }: { lines: ChartLine[] }) {
  return (
    <View>
      {lines.map((line, i) => {
        switch (line.kind) {
          case "section":
            return (
              <Text key={i} style={styles.section} minPresenceAhead={40}>
                {line.text}
              </Text>
            );
          case "chords":
            return (
              <Text key={i} style={styles.chordLine} minPresenceAhead={16}>
                {line.text}
              </Text>
            );
          case "lyric":
            return <ChartLyric key={i} segments={line.segments} />;
          default:
            return <View key={i} style={styles.blank} />;
        }
      })}
    </View>
  );
}

function LyricsBody({ lines }: { lines: LyricLine[] }) {
  return (
    <View>
      {lines.map((line, i) => {
        if (line.kind === "section") {
          return (
            <Text key={i} style={[styles.section, styles.sheetSection]} minPresenceAhead={40}>
              {line.text}
            </Text>
          );
        }
        if (line.kind === "text") {
          return (
            <Text key={i} style={styles.sheetLine}>
              {line.text}
            </Text>
          );
        }
        return <View key={i} style={styles.blank} />;
      })}
    </View>
  );
}

export type SongPdfContent = { kind: "chart"; lines: ChartLine[] } | { kind: "lyrics"; lines: LyricLine[] };

export type SongPdfDocumentProps = {
  song: SongPdfSong;
  arrangement: SongPdfArrangement;
  content: SongPdfContent;
};

export function songPdfMetaLine(arrangement: SongPdfArrangement): string {
  const name = arrangement.name.trim();
  return [
    name ? (/arrangement$/i.test(name) ? name : `${name} arrangement`) : null,
    arrangement.key ? `Key of ${arrangement.key}` : null,
    arrangement.bpm ? `${arrangement.bpm} BPM` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function SongPdfDocument({ song, arrangement, content }: SongPdfDocumentProps) {
  const label = content.kind === "chart" ? "Chord chart" : "Lyrics";
  const meta = songPdfMetaLine(arrangement);
  const ccli = song.ccliNumber ? `CCLI Song # ${song.ccliNumber}` : null;

  return (
    <Document title={`${song.title} – ${label}`} author={song.author ?? undefined} creator="FaithForm">
      <Page size="LETTER" style={styles.page} wrap>
        <View>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.title}>{song.title}</Text>
          {song.author ? <Text style={styles.author}>{song.author}</Text> : null}
          {meta ? <Text style={styles.meta}>{meta}</Text> : null}
        </View>
        <View style={styles.rule} />

        {content.lines.length === 0 ? (
          <Text style={styles.empty}>Nothing to print yet.</Text>
        ) : content.kind === "chart" ? (
          <ChartBody lines={content.lines} />
        ) : (
          <LyricsBody lines={content.lines} />
        )}

        <View style={styles.footer} fixed>
          {ccli ? <Text style={styles.footerCcli}>{ccli}</Text> : null}
          {song.copyright ? <Text style={styles.footerLine}>{copyrightLine(song.copyright)}</Text> : null}
          {!ccli && !song.copyright ? <Text style={styles.footerLine}>{song.title}</Text> : null}
        </View>
        <Text
          style={styles.footerPage}
          fixed
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
        />
      </Page>
    </Document>
  );
}
