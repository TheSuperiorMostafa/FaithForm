import assert from "node:assert/strict";
import test from "node:test";

import {
  detectFormat,
  isChordLine,
  parseChordPro,
  parseCsv,
  parseCsvRecords,
  parseOnSong,
  parseSongFile,
  parseSongSelectText,
  parseSongSelectUsr,
  sectionLabel,
  stripChords,
} from "@/lib/service-plans/songs/parsers";

test("section labels and chord helpers", () => {
  assert.equal(sectionLabel("Verse 1"), "Verse 1");
  assert.equal(sectionLabel("CHORUS:"), "Chorus");
  assert.equal(sectionLabel("pre-chorus"), "Pre-Chorus");
  assert.equal(sectionLabel("V2:"), "Verse 2");
  assert.equal(sectionLabel("Amazing grace how sweet"), null);
  assert.equal(sectionLabel("constructor:"), null);
  assert.equal(stripChords("Ama[G]zing [D/F#]grace"), "Amazing grace");
  assert.equal(isChordLine("G   D/F#  Em7   C"), true);
  assert.equal(isChordLine("A mighty fortress"), false);
});

test("ChordPro: metadata, labelled sections, inline chords and chorus repeats", () => {
  const song = parseChordPro(
    [
      "# a comment",
      "{title: Amazing Grace}",
      "{artist: John Newton}",
      "{key: G}",
      "{tempo: 72 bpm}",
      "{ccli: 22025}",
      "{copyright: Public Domain}",
      "",
      "{start_of_verse: Verse 1}",
      "A[G]mazing grace how [C]sweet the [G]sound",
      "That saved a wretch like [D]me",
      "{end_of_verse}",
      "",
      "{soc}",
      "[G]My chains are gone",
      "{eoc}",
      "{chorus}",
      "{c: Bridge}",
      "The earth shall soon dissolve like snow",
      "",
      "{start_of_tab}",
      "e|---3---|",
      "{end_of_tab}",
    ].join("\n"),
    "amazing.cho",
  );
  assert.equal(song.title, "Amazing Grace");
  assert.equal(song.author, "John Newton");
  assert.equal(song.key, "G");
  assert.equal(song.tempo, 72);
  assert.equal(song.ccliNumber, "22025");
  assert.equal(song.copyright, "Public Domain");
  assert.deepEqual(
    song.sections.map((s) => s.name),
    ["Verse 1", "Chorus", "Bridge"],
  );
  assert.deepEqual(song.sectionOrder, ["Verse 1", "Chorus", "Chorus", "Bridge"]);
  assert.deepEqual(song.sections[0].lines, ["Amazing grace how sweet the sound", "That saved a wretch like me"]);
  assert.match(song.chartText ?? "", /A\[G\]mazing/);
  assert.doesNotMatch(song.lyrics ?? "", /\[|e\|---/);
  assert.deepEqual(song.warnings, []);
});

test("ChordPro: missing title falls back to the file name with a warning", () => {
  const song = parseChordPro("[C]Holy, holy, holy\n", "holy_holy_holy.chordpro");
  assert.equal(song.title, "holy holy holy");
  assert.ok(song.warnings.some((w) => /file name/.test(w)));
  assert.equal(song.sections[0].name, "Verse 1");
});

test("OnSong: title and artist lines, metadata, flow and chords over lyrics", () => {
  const song = parseOnSong(
    [
      "It Is Well",
      "Horatio Spafford",
      "Key: C",
      "Tempo: 64",
      "CCLI: 25376",
      "Flow: V1 C V2 C",
      "",
      "Verse 1:",
      "C          F       C",
      "When peace like a river",
      "",
      "Chorus:",
      "It is [G]well with my [C]soul",
      "",
      "Verse 2:",
      "Though Satan should buffet",
    ].join("\n"),
    "it-is-well.onsong",
  );
  assert.equal(song.title, "It Is Well");
  assert.equal(song.author, "Horatio Spafford");
  assert.equal(song.key, "C");
  assert.equal(song.tempo, 64);
  assert.equal(song.ccliNumber, "25376");
  assert.deepEqual(song.sectionOrder, ["Verse 1", "Chorus", "Verse 2", "Chorus"]);
  assert.deepEqual(song.sections[0].lines, ["When peace like a river"]);
  assert.match(song.chartText ?? "", /C {10}F/);
  assert.match(song.lyrics ?? "", /It is well with my soul/);
});

test("OnSong: Title: metadata header without a separate artist line", () => {
  const song = parseOnSong("Title: Be Thou My Vision\nArtist: Mary Byrne | Eleanor Hull\nKey: E minor\n\nVerse 1\nBe Thou my vision\n");
  assert.equal(song.title, "Be Thou My Vision");
  assert.equal(song.author, "Mary Byrne, Eleanor Hull");
  assert.equal(song.key, "Em");
  assert.deepEqual(song.sections, [{ name: "Verse 1", lines: ["Be Thou my vision"] }]);
});

test("SongSelect .usr: header CCLI number, fields and words", () => {
  const song = parseSongSelectUsr(
    [
      "[File]",
      "Type=SongSelect Import File",
      "Version=3.0",
      "[S A7046046]",
      "Title=Come Thou Fount",
      "Author=Robert Robinson | John Wyeth",
      "Copyright=Public Domain",
      "Themes=Grace/tPraise",
      "Keys=D",
      "Fields=Verse 1/tVerse 2/tChorus",
      "Words=Come Thou fount/nTune my heart/tHere I raise/nHither by/tProne to wander",
    ].join("\r\n"),
  );
  assert.equal(song.title, "Come Thou Fount");
  assert.equal(song.ccliNumber, "7046046");
  assert.equal(song.author, "Robert Robinson, John Wyeth");
  assert.equal(song.key, "D");
  assert.deepEqual(song.themes, ["Grace", "Praise"]);
  assert.deepEqual(
    song.sections.map((s) => [s.name, s.lines.length]),
    [
      ["Verse 1", 2],
      ["Verse 2", 2],
      ["Chorus", 1],
    ],
  );
  assert.equal(song.chartText, null);
});

test("SongSelect lyrics sheet: footer gives CCLI number, writers and copyright, not the licence", () => {
  const text = [
    "Blessed Assurance",
    "",
    "Verse 1",
    "Blessed assurance Jesus is mine",
    "O what a foretaste of glory divine",
    "",
    "Chorus",
    "This is my story this is my song",
    "",
    "CCLI Song # 22324",
    "Fanny Crosby | Phoebe Knapp",
    "Public Domain",
    "For use solely with the SongSelect® Terms of Use. All rights reserved. www.ccli.com",
    "CCLI License # 1234567",
  ].join("\n");
  assert.equal(detectFormat("blessed.txt", text), "songselect");
  const song = parseSongSelectText(text, "blessed.txt");
  assert.equal(song.title, "Blessed Assurance");
  assert.equal(song.ccliNumber, "22324");
  assert.equal(song.author, "Fanny Crosby, Phoebe Knapp");
  assert.equal(song.copyright, "Public Domain");
  assert.deepEqual(song.sectionOrder, ["Verse 1", "Chorus"]);
  assert.deepEqual(song.warnings, []);
});

test("CSV: quoted commas, quotes and newlines, header aliases and skipped rows", () => {
  const csv = [
    "Song Title,Authors,CCLI #,Key,BPM,Tags",
    '"Holy, Holy, Holy","Reginald Heber, John Dykes",1156,D,90,"Hymn; Worship"',
    '"Crown Him ""With"" Many Crowns","Matthew Bridges",,Eb,abc,',
    ',No title here,,,,',
    '"A Mighty Fortress","Martin Luther',
    'tr. Frederick Hedge",42964,C,,Hymn',
  ].join("\r\n");
  assert.equal(parseCsvRecords(csv).length, 5);
  const { songs, warnings } = parseCsv(csv);
  assert.equal(songs.length, 3);
  assert.equal(songs[0].title, "Holy, Holy, Holy");
  assert.equal(songs[0].author, "Reginald Heber, John Dykes");
  assert.equal(songs[0].ccliNumber, "1156");
  assert.equal(songs[0].tempo, 90);
  assert.deepEqual(songs[0].tags, ["Hymn", "Worship"]);
  assert.equal(songs[1].title, 'Crown Him "With" Many Crowns');
  assert.equal(songs[1].key, "Eb");
  assert.equal(songs[1].tempo, null);
  assert.ok(songs[1].warnings.some((w) => /tempo/.test(w)));
  assert.equal(songs[2].author, "Martin Luther\ntr. Frederick Hedge");
  assert.deepEqual(warnings, ["Row 4 has no title and was skipped."]);
});

test("CSV without a title column says so", () => {
  const { songs, warnings } = parseCsv("Thing,Writer\nx,y\n");
  assert.equal(songs.length, 0);
  assert.match(warnings[0], /Title column/);
});

test("detectFormat and parseSongFile dispatch", () => {
  assert.equal(detectFormat("a.cho", ""), "chordpro");
  assert.equal(detectFormat("a.onsong", ""), "onsong");
  assert.equal(detectFormat("a.usr", ""), "songselect");
  assert.equal(detectFormat("a.csv", ""), "csv");
  assert.equal(detectFormat("a.txt", "{title: X}\n"), "chordpro");
  assert.equal(detectFormat("a.txt", "[S A123]\nTitle=X"), "songselect");
  assert.equal(detectFormat("a.txt", "Just a song\nVerse 1\nWords"), "onsong");
  assert.equal(detectFormat("a.pdf", "%PDF"), null);

  const unreadable = parseSongFile("chart.pdf", "%PDF-1.4");
  assert.equal(unreadable.format, null);
  assert.equal(unreadable.songs.length, 0);

  const usr = parseSongFile("song.usr", "[S A1]\nTitle=X\nFields=Verse 1\nWords=Line");
  assert.equal(usr.songs[0].ccliNumber, "1");
});

test("bad CCLI numbers and keys are dropped with warnings", () => {
  const song = parseChordPro("{title: X}\n{ccli: abc}\n{key: H#}\nLine\n");
  assert.equal(song.ccliNumber, null);
  assert.equal(song.key, null);
  assert.equal(song.warnings.length, 2);
});

test("usage report CSV escapes cells and validates the date range", async () => {
  const { parseUsageRange, usageReportCsv } = await import("@/lib/service-plans/songs/report");
  const csv = usageReportCsv([
    {
      date: "2026-11-01",
      serviceType: "Sunday Morning",
      planTitle: null,
      songTitle: "Holy, Holy, Holy",
      author: "=HYPERLINK(1)",
      ccliNumber: "1156",
      arrangement: "Default",
      key: "D",
    },
  ]);
  assert.equal(
    csv,
    '﻿Date,Service type,Plan title,Song title,Author,CCLI number,Arrangement,Key\r\n2026-11-01,Sunday Morning,,"Holy, Holy, Holy",\'=HYPERLINK(1),1156,Default,D\r\n',
  );
  assert.deepEqual(parseUsageRange("2026-01-01", "2026-12-31"), { from: "2026-01-01", to: "2026-12-31" });
  assert.equal(parseUsageRange("2026-12-31", "2026-01-01"), null);
  assert.equal(parseUsageRange("2026-1-1", "2026-12-31"), null);
  assert.equal(parseUsageRange("2010-01-01", "2026-12-31"), null);
});
