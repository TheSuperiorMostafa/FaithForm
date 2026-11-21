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

const CHART = [
  "Verse 1",
  "[G]Amazing grace, how [C]sweet the [G]sound",
  "That saved a wretch like [D]me",
  "",
  "",
  "Chorus",
  "G        C       G",
  "I once was lost, but now am found",
  "Chorus (2)",
  "Was [Em]blind but [D]now I [G]see",
  "",
].join("\n");

const SONG = { title: "Amazing Grace", author: "John Newton", ccliNumber: "22025", copyright: "Public Domain" };
const ARRANGEMENT = { name: "Default", key: "G", bpm: 72 };

test("inline chords become chord-over-syllable segments", () => {
  assert.deepEqual(chartSegments("[G]Amazing grace, how [C]sweet"), [
    { chord: "G", text: "Amazing grace, how " },
    { chord: "C", text: "sweet" },
  ]);
  // A chord inside a word, words before the first chord, and a chord at the end.
  assert.deepEqual(chartSegments("Ama[D/F#]zing [G]"), [
    { chord: null, text: "Ama" },
    { chord: "D/F#", text: "zing " },
    { chord: "G", text: "" },
  ]);
  assert.deepEqual(chartSegments("No chords here"), [{ chord: null, text: "No chords here" }]);
});

test("chart lines: sections, chord-only lines, lyrics and single blanks", () => {
  const lines = parseChartLines(CHART);
  assert.deepEqual(
    lines.map((l) => l.kind),
    ["section", "lyric", "lyric", "blank", "section", "chords", "lyric", "section", "lyric"],
  );
  assert.deepEqual(lines[0], { kind: "section", text: "Verse 1" });
  assert.deepEqual(lines[5], { kind: "chords", text: "G   C   G" });
  assert.deepEqual(lines[7], { kind: "section", text: "Chorus (2)" });
  const first = lines[1];
  assert.ok(first.kind === "lyric");
  assert.deepEqual(
    first.segments.map((s) => s.chord),
    ["G", "C", "G"],
  );
});

test("lyrics come from the chart when the lyrics box is empty", () => {
  assert.equal(
    lyricsFromChart(CHART),
    [
      "Verse 1",
      "Amazing grace, how sweet the sound",
      "That saved a wretch like me",
      "",
      "Chorus",
      "I once was lost, but now am found",
      "Chorus (2)",
      "Was blind but now I see",
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
  assert.equal(songPdfFileName("Amazing Grace", "Default", "lyrics"), "amazing-grace-default-lyrics.pdf");
  assert.equal(songPdfFileName("10,000 Reasons (Bless the Lord)", "Acoustic", "chart"), "10-000-reasons-bless-the-lord-acoustic-chord-chart.pdf");
  assert.equal(songPdfFileName("¡¡", "", "chart"), "song-chord-chart.pdf");
  assert.equal(songPdfMetaLine(ARRANGEMENT), "Default arrangement · Key of G · 72 BPM");
  assert.equal(songPdfMetaLine({ name: "Christmas Arrangement", key: null, bpm: null }), "Christmas Arrangement");
  assert.equal(copyrightLine("Public Domain"), "Public Domain");
  assert.equal(copyrightLine("2004 sixsteps Music"), "© 2004 sixsteps Music");
});

test("renderSongPdf returns a real PDF for the chart and the lyrics", async () => {
  const sources = songPdfSources({ chartText: CHART, lyrics: null });
  for (const kind of ["chart", "lyrics"] as const) {
    const buffer = await renderSongPdf({ kind, song: SONG, arrangement: ARRANGEMENT, text: sources[kind]! });
    assert.ok(buffer.length > 1000, `${kind} PDF is not empty`);
    assert.equal(buffer.subarray(0, 4).toString("latin1"), "%PDF");
  }
  // A long chart spills onto more pages without failing.
  const long = Array.from({ length: 40 }, (_, i) => `Verse ${(i % 9) + 1}\n${"[G]Lord, I [C]lift Your [D]name on [G]high ".repeat(4)}`).join("\n\n");
  const buffer = await renderSongPdf({
    kind: "chart",
    song: { ...SONG, ccliNumber: null, copyright: null },
    arrangement: { name: "Long", key: null, bpm: null },
    text: long,
  });
  assert.equal(buffer.subarray(0, 4).toString("latin1"), "%PDF");
});
