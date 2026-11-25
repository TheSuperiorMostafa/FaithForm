import "../support/stub-server-only";

import assert from "node:assert/strict";
import test from "node:test";

import { copyrightLine, songPdfMetaLine } from "@/components/service-plans/pdf/song-pdf";
import {
  chartSegments,
  lyricsFromChart,
  parseChartLines,
  parseLyricLines,
  renderSongPdf,
  songPdfFileName,
  songPdfSources,
} from "@/lib/service-plans/songs/song-pdf";

// Invented placeholder words only; no real song text in fixtures.
const CHART = [
  "Verse 1",
  "[G]Morning light is on the [C]hill, the [G]valley",
  "We will sing and we will [D]rest",
  "",
  "",
  "Chorus",
  "G        C       G",
  "Lanterns glow along the river",
  "Chorus (2)",
  "All the [Em]fields are [D]green and [G]bright",
  "",
].join("\n");

const SONG = { title: "Morning Light", author: "A. Writer", ccliNumber: "1234567", copyright: "Public Domain" };
const ARRANGEMENT = { name: "Default", key: "G", bpm: 72 };

test("inline chords become chord-over-syllable segments", () => {
  assert.deepEqual(chartSegments("[G]Morning light is on the [C]hill"), [
    { chord: "G", text: "Morning light is on the " },
    { chord: "C", text: "hill" },
  ]);
  // A chord inside a word, words before the first chord, and a chord at the end.
  assert.deepEqual(chartSegments("Lan[D/F#]terns [G]"), [
    { chord: null, text: "Lan" },
    { chord: "D/F#", text: "terns " },
    { chord: "G", text: "" },
  ]);
  assert.deepEqual(chartSegments("No chords here"), [{ chord: null, text: "No chords here" }]);
});

test("chart lines: sections, lyrics, a chord line merged with the words under it, single blanks", () => {
  const lines = parseChartLines(CHART);
  assert.deepEqual(
    lines.map((l) => l.kind),
    ["section", "lyric", "lyric", "blank", "section", "lyric", "section", "lyric"],
  );
  assert.deepEqual(lines[0], { kind: "section", text: "Verse 1" });
  assert.deepEqual(lines[6], { kind: "section", text: "Chorus (2)" });
  const first = lines[1];
  assert.ok(first.kind === "lyric");
  assert.deepEqual(
    first.segments.map((s) => s.chord),
    ["G", "C", "G"],
  );
  // "G        C       G" above "Lanterns glow along the river": each chord at its column.
  const merged = lines[5];
  assert.ok(merged.kind === "lyric");
  assert.deepEqual(merged.segments, [
    { chord: "G", text: "Lanterns " },
    { chord: "C", text: "glow alo" },
    { chord: "G", text: "ng the river" },
  ]);
});

test("lyrics come from the chart when the lyrics box is empty", () => {
  assert.equal(
    lyricsFromChart(CHART),
    [
      "Verse 1",
      "Morning light is on the hill, the valley",
      "We will sing and we will rest",
      "",
      "Chorus",
      "Lanterns glow along the river",
      "Chorus (2)",
      "All the fields are green and bright",
    ].join("\n"),
  );
  // Section names and chords alone are not lyrics.
  assert.equal(lyricsFromChart("Verse 1\nG C D\n[G] [C]"), null);

  assert.deepEqual(songPdfSources({ chartText: CHART, lyrics: null }), { chart: CHART, lyrics: lyricsFromChart(CHART) });
  assert.deepEqual(songPdfSources({ chartText: CHART, lyrics: "Own words" }).lyrics, "Own words");
  assert.deepEqual(songPdfSources({ chartText: null, lyrics: "  " }), { chart: null, lyrics: null });
  assert.deepEqual(songPdfSources({ chartText: "Verse 1\n", lyrics: null }), { chart: null, lyrics: null });
});

test("lyric lines keep sections and collapse blank runs", () => {
  assert.deepEqual(parseLyricLines("VERSE 1:\nLine one\n\n\n\nChorus\nLine two\n\n"), [
    { kind: "section", text: "Verse 1" },
    { kind: "text", text: "Line one" },
    { kind: "blank" },
    { kind: "section", text: "Chorus" },
    { kind: "text", text: "Line two" },
  ]);
});

test("file names, header and footer text", () => {
  assert.equal(songPdfFileName("Morning Light", "Default", "lyrics"), "morning-light-default-lyrics.pdf");
  assert.equal(songPdfFileName("1,000 Lanterns (Live)", "Acoustic", "chart"), "1-000-lanterns-live-acoustic-chord-chart.pdf");
  assert.equal(songPdfFileName("¡¡", "", "chart"), "song-chord-chart.pdf");
  assert.equal(songPdfMetaLine(ARRANGEMENT), "Default arrangement · Key of G · 72 BPM");
  assert.equal(songPdfMetaLine({ name: "Christmas Arrangement", key: null, bpm: null }), "Christmas Arrangement");
  assert.equal(copyrightLine("Public Domain"), "Public Domain");
  assert.equal(copyrightLine("2004 Example Music"), "© 2004 Example Music");
});

test("renderSongPdf returns a real PDF for the chart and the lyrics", async () => {
  const sources = songPdfSources({ chartText: CHART, lyrics: null });
  for (const kind of ["chart", "lyrics"] as const) {
    const buffer = await renderSongPdf({ kind, song: SONG, arrangement: ARRANGEMENT, text: sources[kind]! });
    assert.ok(buffer.length > 1000, `${kind} PDF is not empty`);
    assert.equal(buffer.subarray(0, 4).toString("latin1"), "%PDF");
  }
  // A long chart spills onto more pages without failing.
  const long = Array.from(
    { length: 40 },
    (_, i) => `Verse ${(i % 9) + 1}\n${"[G]Over the [C]hills the [D]morning [G]comes ".repeat(4)}`,
  ).join("\n\n");
  const buffer = await renderSongPdf({
    kind: "chart",
    song: { ...SONG, ccliNumber: null, copyright: null },
    arrangement: { name: "Long", key: null, bpm: null },
    text: long,
  });
  assert.equal(buffer.subarray(0, 4).toString("latin1"), "%PDF");
});
